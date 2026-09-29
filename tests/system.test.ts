import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import request from "supertest";
import { z } from "zod";
const directory = mkdtempSync(join(tmpdir(), "touchline-test-"));
process.env.DATA_DIR = directory;
process.env.APP_SECRET = "a".repeat(64);
process.env.SETUP_TOKEN = "test-setup-token";
const { createApp } = await import("../server/app.js");
const { db, seal, unseal, researchConfig, searchConfig, uid } =
  await import("../server/db.js");
const { complete, completeJson, modelRequest, parseJson } =
  await import("../server/models.js");
const { isPublicIp, requestText, canonicalUrl } =
  await import("../server/network.js");
const { normalizeFixtures } = await import("../server/fixtures.js");
const { runResearch, validateClaim, updateJobBudget, controlJob, writeReport } =
  await import("../server/research.js");
const { STAGES, METRICS } = await import("../server/domain.js");
import type { Provider, Source } from "../server/domain.js";
import type { ResearchServices } from "../server/research.js";
const app = createApp(),
  admin = request.agent(app);
const password = "test-admin-password-123";
let providerId = "",
  fixtureId = "",
  adminId = "";
after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
test("isolated system integration", async (t) => {
  await t.test(
    "setup token, authentication, session cookie and encrypted credentials",
    async () => {
      await request(app).get("/api/dashboard").expect(401);
      await request(app)
        .post("/api/auth/setup")
        .send({ username: "admin", password, setupToken: "wrong" })
        .expect(403);
      await request(app)
        .post("/api/auth/setup")
        .send({ username: "admin", password, setupToken: "test-setup-token" })
        .expect(201);
      await request(app)
        .post("/api/auth/setup")
        .send({ username: "admin", password, setupToken: "test-setup-token" })
        .expect(409);
      const login = await admin
        .post("/api/auth/login")
        .send({ username: "admin", password })
        .expect(200);
      adminId = login.body.user.id;
      assert.match(String(login.headers["set-cookie"]), /HttpOnly/);
      assert.match(String(login.headers["set-cookie"]), /SameSite=Strict/);
      const created = await admin
        .post("/api/providers")
        .send({
          name: "Test provider",
          type: "openai",
          baseUrl: "http://127.0.0.1:65530/v1",
          model: "test",
          apiKey: "sensitive-test-key",
        })
        .expect(201);
      providerId = created.body.id;
      const stored = String(
        db.prepare("SELECT secret FROM providers WHERE id=?").get(providerId)
          ?.secret,
      );
      assert.notEqual(stored, "sensitive-test-key");
      assert.equal(unseal(stored), "sensitive-test-key");
      assert.notEqual(seal("same"), seal("same"));
      const listed = await admin.get("/api/providers").expect(200);
      assert.equal(listed.body[0].hasKey, true);
      assert(!JSON.stringify(listed.body).includes("sensitive-test-key"));
      await admin
        .post("/api/fixtures")
        .set("Origin", "https://hostile.example")
        .send({})
        .expect(403);
    },
  );
  await t.test(
    "role restrictions, disabled users and last administrator",
    async () => {
      await admin
        .post("/api/users")
        .send({ username: "reader", password, role: "viewer" })
        .expect(201);
      const viewer = request.agent(app);
      await viewer
        .post("/api/auth/login")
        .send({ username: "reader", password })
        .expect(200);
      await viewer.get("/api/dashboard").expect(200);
      await viewer.get("/api/settings").expect(403);
      await viewer.post("/api/fixtures").send({}).expect(403);
      await admin
        .post("/api/users")
        .send({
          username: "disabled",
          password,
          role: "researcher",
          enabled: false,
        })
        .expect(201);
      await request(app)
        .post("/api/auth/login")
        .send({ username: "disabled", password })
        .expect(401);
      await admin
        .patch("/api/users/" + adminId)
        .send({ enabled: false })
        .expect(409);
      await admin
        .patch("/api/users/" + adminId)
        .send({ role: "viewer" })
        .expect(409);
    },
  );
  await t.test("fixtures parse and task scheduling validation", async () => {
    const rows = normalizeFixtures({
      matches: [
        {
          matchId: 12,
          homeTeamAbbName: "测试主队",
          awayTeamAbbName: "测试客队",
          leagueAbbName: "测试联赛",
          matchDate: "2027-01-01",
          matchTime: "20:00",
        },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kickoff, "2027-01-01T12:00:00.000Z");
    const extra = await admin
      .post("/api/fixtures")
      .send({
        home: "Temporary",
        away: "Other",
        league: "Test",
        kickoff: new Date(Date.now() + 86400000).toISOString(),
      })
      .expect(201);
    await admin
      .put("/api/fixtures/" + extra.body.id)
      .send({
        home: "Edited",
        away: "Other",
        league: "Test",
        kickoff: new Date(Date.now() + 86400000).toISOString(),
      })
      .expect(200);
    assert.equal(
      JSON.parse(
        String(
          db.prepare("SELECT data FROM fixtures WHERE id=?").get(extra.body.id)
            ?.data,
        ),
      ).home,
      "Edited",
    );
    await admin.delete("/api/fixtures/" + extra.body.id).expect(200);
    const f = await admin
      .post("/api/fixtures")
      .send({
        home: "Alpha",
        away: "Beta",
        league: "Test league",
        kickoff: new Date(Date.now() + 86400000 * 7).toISOString(),
      })
      .expect(201);
    fixtureId = f.body.id;
    await admin
      .post("/api/jobs")
      .send({
        fixtureId,
        providerId,
        direction: "主队不败",
        runAfter: new Date(Date.now() + 86400000 * 8).toISOString(),
      })
      .expect(400);
  });
  await t.test("public network policy and canonical URLs", async () => {
    for (const address of [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "0.0.0.0",
    ])
      assert.equal(isPublicIp(address), false, address);
    assert.equal(isPublicIp("8.8.8.8"), true);
    await assert.rejects(requestText("http://127.0.0.1:1"), /已阻止/);
    await assert.rejects(requestText("file:///etc/passwd"), /HTTP/);
    assert.equal(
      canonicalUrl("https://example.com/x?utm_source=bad&a=1#h"),
      "https://example.com/x?a=1",
    );
  });
  await t.test(
    "all five model protocols, token compatibility and JSON retries",
    async () => {
      let count = 0;
      const payloads: any[] = [];
      const mock = createServer(async (req, res) => {
        let raw = "";
        for await (const part of req) raw += part;
        const b = JSON.parse(raw);
        payloads.push(b);
        count++;
        res.setHeader("content-type", "application/json");
        if (req.url?.includes("legacy") && b.max_completion_tokens) {
          res.statusCode = 400;
          res.end("{}");
          return;
        }
        const text =
          b.model === "retry" && count === 1 ? "invalid" : '{"ok":true}';
        if (req.url?.endsWith("/responses"))
          res.end(
            JSON.stringify({
              output: [{ content: [{ type: "output_text", text }] }],
              usage: { total_tokens: 12 },
            }),
          );
        else if (req.url?.endsWith("/messages"))
          res.end(
            JSON.stringify({
              content: [{ type: "text", text }],
              usage: { input_tokens: 7, output_tokens: 5 },
            }),
          );
        else if (req.url?.includes("generateContent"))
          res.end(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text }] } }],
              usageMetadata: { totalTokenCount: 12 },
            }),
          );
        else if (req.url?.endsWith("/api/chat"))
          res.end(
            JSON.stringify({
              message: { content: text },
              prompt_eval_count: 7,
              eval_count: 5,
            }),
          );
        else
          res.end(
            JSON.stringify({
              choices: [{ message: { content: text } }],
              usage: { total_tokens: 12 },
            }),
          );
      });
      await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
      const addr = mock.address() as { port: number };
      const base = "http://127.0.0.1:" + addr.port;
      try {
        for (const type of [
          "openai",
          "responses",
          "anthropic",
          "gemini",
          "ollama",
        ] as Provider["type"][]) {
          const p: Provider = {
            id: "test",
            name: "Test",
            type,
            baseUrl: base,
            model: "fixture-model",
            secret: "test-secret",
            enabled: true,
            maxTokens: 4096,
            timeoutSeconds: 10,
          };
          const output = await complete(p, "test");
          assert.deepEqual(parseJson(output.text), { ok: true });
          assert.equal(output.tokens, 12);
          assert(modelRequest(p, "test").url.startsWith(base));
        }
        let counted = 0;
        const p: Provider = {
          id: "test",
          name: "Test",
          type: "openai",
          baseUrl: base + "/legacy",
          model: "test",
          secret: "",
          enabled: true,
          maxTokens: 512,
          timeoutSeconds: 10,
        };
        await completeJson(
          p,
          "test",
          z.object({ ok: z.literal(true) }),
          undefined,
          undefined,
          () => counted++,
        );
        assert.equal(counted, 2);
        assert.equal(payloads.at(-1).max_tokens, 512);
        count = 0;
        counted = 0;
        p.baseUrl = base;
        p.model = "retry";
        await completeJson(
          p,
          "test",
          z.object({ ok: z.literal(true) }),
          undefined,
          undefined,
          () => counted++,
        );
        assert.equal(counted, 2);
        count = 0;
        counted = 0;
        await assert.rejects(
          completeJson(
            p,
            "test",
            z.object({ ok: z.literal(true) }),
            undefined,
            undefined,
            () => {
              if (++counted > 1) throw new Error("budget");
            },
          ),
          /budget/,
        );
        assert.equal(count, 1);
      } finally {
        await new Promise<void>((r) => mock.close(() => r()));
      }
    },
  );
  const makeJob = async (config: Record<string, unknown> = {}) => {
    const r = await admin
      .post("/api/jobs")
      .send({ fixtureId, providerId, direction: "Alpha 主队不败" })
      .expect(201);
    const id = r.body.id as string;
    db.prepare("UPDATE jobs SET status=?,config=? WHERE id=?").run(
      "running",
      JSON.stringify({ ...researchConfig(), ...config }),
      id,
    );
    return id;
  };
  const mockServices = (
    jobId: string,
    omitOpposes = false,
  ): ResearchServices => {
    let searches = 0;
    const quoteA =
      "Alpha recorded 12 attempts and 8 successful recoveries in its confirmed recent match.";
    const quoteB =
      "Beta threatens the wide channel and can overturn the proposed home advantage.";
    const quoteC =
      "The official team update confirms a stable starting core for this fixture.";
    return {
      search: async (query, _config, _signal, intent) => {
        assert.match(intent || "", /用户研究方向（数据）：/);
        assert((intent || "").includes("Alpha 主队不败"));
        assert.match(intent || "", /支持.*独立佐证/);
        return {
          hits: [0, 1].map((i) => ({
            url:
              "https://" +
              (i ? "second.example" : "first.example") +
              "/" +
              ++searches,
            title: "Verified test source",
            snippet: "Not evidence",
            published: "2025-01-01T00:00:00.000Z",
            engine: "mock",
          })),
          warnings: [],
        };
      },
      read: async (hit) => ({
        id: uid(),
        url: hit.url,
        title: hit.title,
        domain: new URL(hit.url).hostname,
        text: [
          quoteA,
          quoteB,
          quoteC,
          "Alpha vs Other on 2025-01-02 is a confirmed official match.",
          "Beta vs Other on 2025-01-03 is a confirmed official match.",
        ].join(" "),
        snippet: hit.snippet,
        published: hit.published,
        fetchedAt: new Date().toISOString(),
        status: "read",
        engine: "mock",
        tier: "official_or_trusted",
      }),
      ask: async (_provider, prompt, schema, _signal, usage, before) => {
        assert.equal(_provider.thinking?.mode, "enabled");
        assert.equal(_provider.thinking?.effort, "high");
        assert(prompt.includes("每轮先判断现有材料能回答什么"));
        assert(prompt.includes("每一个阶段都先拆解该方向"));
        assert(prompt.includes('"direction":"Alpha 主队不败"'));
        before?.();
        usage?.(10);
        const ss = db
          .prepare("SELECT data FROM sources WHERE job_id=?")
          .all(jobId)
          .map((r) => JSON.parse(String(r.data)))
          .filter((s: any) =>
            prompt.includes(JSON.stringify({ id: s.id }).slice(0, -1)),
          );
        const first = ss[0],
          last = ss.at(-1);
        let output: any;
        if (prompt.includes("制定搜索计划")) {
          const marker = prompt.split("为阶段「")[1].split("」")[0];
          output = {
            queries: [
              {
                query: "Alpha Beta " + marker + " 2026 independent report",
                reason: "用独立报告佐证支持条件",
                purpose: "corroboration",
                supportAngle: "核对支持主队不败的事实能否由独立来源佐证",
              },
              {
                query: "Alpha Beta " + marker + " 2026 official",
                reason: "寻找支持主队不败的事实",
                purpose: "support",
                supportAngle: "核验有利于用户不败方向的具体比赛条件",
              },
            ],
            hypotheses: ["前提一", "前提二", "前提三", "前提四", "前提五"],
          };
        } else if (prompt.includes("执行独立覆盖与来源审计"))
          output = {
            issues: [],
            gaps: [],
            followups: [
              {
                query:
                  "Alpha Beta conflict check " +
                  prompt.split("。阶段")[1].split("，")[0],
                reason: "核对支持材料中的风险",
                purpose: "verification",
                supportAngle: "核查支持主张所需条件的冲突",
              },
              {
                query:
                  "Alpha Beta corroboration " +
                  prompt.split("。阶段")[1].split("，")[0],
                reason: "补充支持主张的独立原始材料",
                purpose: "corroboration",
                supportAngle: "佐证主队不败所需条件，不能把转载算作独立来源",
              },
            ],
          };
        else if (prompt.includes("执行最终逐条引语支持审核")) {
          output = {
            decisions: JSON.parse(prompt.split("候选：")[1]).map((c: any) => ({
              index: c.index,
              sourceId: c.sourceId,
              verdict: c.mechanicalRejection ? "unsupported" : "supported",
              reason: c.mechanicalRejection || "与原文主体一致",
            })),
          };
        } else if (prompt.includes("只提取这场历史比赛")) {
          const names = JSON.parse(
            prompt.split(" 的指标 ")[1].split("。原文：")[0],
          );
          output = {
            metrics: names.map((name: string) => ({
              name,
              home: "12",
              away: "8",
              sourceId: first.id,
              quote: quoteA,
              provider: "Test provider",
              definition: "同一场比赛同一来源",
            })),
          };
        } else if (prompt.includes("综合已通过引语核验")) {
          const ids = db
            .prepare("SELECT id,data FROM evidence WHERE job_id=?")
            .all(jobId);
          const support = ids
            .filter((x) => JSON.parse(String(x.data)).effect === "supports")
            .map((x) => String(x.id));
          const oppose = ids
            .filter((x) => JSON.parse(String(x.data)).effect === "opposes")
            .map((x) => String(x.id));
          output = {
            verdict: "弱支持",
            confidence: "medium",
            summary: "有条件支持，仍保留对方威胁。",
            supporting: [
              { text: "有记录的支持事实", evidenceIds: support.slice(0, 1) },
            ],
            opposing: oppose.length
              ? [{ text: "对手有可验证威胁", evidenceIds: oppose.slice(0, 1) }]
              : [],
            chains: [1, 2, 3].map((i) => ({
              text: "因果链 " + i,
              evidenceIds: support.slice(0, 1),
            })),
            scenarios: [],
            unknowns: [],
            recheck: ["确认首发"],
          };
        } else if (prompt.includes("写原创中文赛前口播草稿"))
          output = {
            paragraphs: [
              {
                text: "经核验的原创草稿。",
                evidenceIds: [
                  String(
                    db
                      .prepare("SELECT id FROM evidence WHERE job_id=? LIMIT 1")
                      .get(jobId)?.id,
                  ),
                ],
              },
            ],
          };
        else {
          output = {
            summary: "阶段已核查",
            claims: [
              {
                claim: "支持事实A",
                quote: quoteA,
                sourceId: first.id,
                effect: "supports",
                kind: "fact",
                confidence: "high",
              },
              {
                claim: "反对事实B",
                quote: quoteB,
                sourceId: last.id,
                effect: "opposes",
                kind: "fact",
                confidence: "high",
              },
              {
                claim: "支持事实C",
                quote: quoteC,
                sourceId: last.id,
                effect: "supports",
                kind: "fact",
                confidence: "high",
              },
              {
                claim: "必须被剔除的虚构事实",
                quote:
                  "This invented quotation is not contained in the source.",
                sourceId: first.id,
                effect: "supports",
                kind: "fact",
                confidence: "high",
              },
            ],
            gaps: [],
            followups: [],
            topics: [1, 2, 3, 4, 5].map((i) => ({
              title: "候选题" + i,
              question: "是否成立",
              counterexample: "对应反例",
            })),
            selectedTopic: "候选题1",
            recentMatches: [
              {
                home: "Alpha",
                away: "Other",
                date: "2025-01-02",
                sourceId: first.id,
                quote:
                  "Alpha vs Other on 2025-01-02 is a confirmed official match.",
                reason: "主队关键场次",
                team: "home",
              },
              {
                home: "Beta",
                away: "Other",
                date: "2025-01-03",
                sourceId: last.id,
                quote:
                  "Beta vs Other on 2025-01-03 is a confirmed official match.",
                reason: "客队关键场次",
                team: "away",
              },
            ],
          };
        }
        if (omitOpposes && output.claims)
          output.claims = output.claims.filter(
            (c: any) => c.effect !== "opposes",
          );
        for (const claim of output.claims || [])
          claim.directionReason =
            claim.effect === "supports"
              ? "该事实可为主队不败所需的稳定表现提供支持，强度受样本限制"
              : "该事实体现主队不败方向的风险或需要排除的误差";
        return schema.parse(output);
      },
    };
  };
  await t.test(
    "full research: 12 audited stages, counterevidence, 38 metrics and exports",
    async () => {
      const id = await makeJob();
      await runResearch(id, new AbortController().signal, mockServices(id));
      const result = await admin.get("/api/jobs/" + id).expect(200);
      const j = result.body;
      assert.equal(j.stages.length, STAGES.length);
      assert(
        j.stages.every(
          (s: any) =>
            s.status === "closed" && s.data.audit && s.data.followups[0].done,
        ),
      );
      const packs = j.stages.find((s: any) => s.stage_id === "recent").data
        .packs;
      assert.equal(packs.length, 2);
      assert(
        packs.every(
          (p: any) =>
            p.metrics.length === METRICS.length &&
            p.metrics.every((m: any) => m.status === "verified"),
        ),
      );
      assert.equal(j.context.reportPartial, false);
      assert(j.report.script);
      assert(j.context.scriptBindings.length);
      assert(j.evidence.some((e: any) => e.effect === "opposes"));
      assert(!j.evidence.some((e: any) => e.claim.includes("虚构")));
      assert.equal(j.model_calls, 72);
      assert.equal(j.queries, 46);
      for (const s of j.stages) {
        assert.equal(s.data.directionPolicyVersion, 1);
        assert.deepEqual(
          s.data.plan.queries.map((q: any) => q.purpose),
          ["support", "corroboration"],
        );
        assert.equal(s.data.searches[0].purpose, "support");
        assert.equal(s.data.searches[1].purpose, "corroboration");
        assert.equal(s.data.followups[0].purpose, "corroboration");
        assert(s.data.searches.every((q: any) => q.supportAngle?.length > 0));
      }
      assert(j.evidence.every((e: any) => e.directionReason));
      assert.match(j.report.markdown, /支持方向的证据与佐证/);
      const exported = await admin
        .get("/api/reports/" + id + "/export?format=json")
        .expect(200);
      assert.equal(exported.body.stages.length, 12);
      assert(exported.body.sources[0].text);
      assert.match(j.report.markdown, /信息冻结/);
      writeReport(id, null, "重新检查中的受限报告");
      assert.equal(
        db.prepare("SELECT script FROM reports WHERE job_id=?").get(id)?.script,
        "",
      );
      assert.equal(
        JSON.parse(
          String(
            db.prepare("SELECT context FROM jobs WHERE id=?").get(id)?.context,
          ),
        ).scriptBindings,
        undefined,
      );
      await admin.delete("/api/providers/" + providerId).expect(409);
      await admin.delete("/api/fixtures/" + fixtureId).expect(409);
      db.prepare("UPDATE jobs SET status=? WHERE id=?").run("completed", id);
      await admin.delete("/api/jobs/" + id).expect(200);
      assert.equal(
        db.prepare("SELECT job_id FROM reports WHERE job_id=?").get(id),
        undefined,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE job_id=?").get(id)
          ?.n,
        0,
      );
    },
  );
  await t.test(
    "verified support can produce a draft without inventing opposing evidence",
    async () => {
      const id = await makeJob();
      await runResearch(
        id,
        new AbortController().signal,
        mockServices(id, true),
      );
      const result = await admin.get("/api/jobs/" + id).expect(200);
      assert(result.body.evidence.some((e: any) => e.effect === "supports"));
      assert(!result.body.evidence.some((e: any) => e.effect === "opposes"));
      assert(result.body.report.script);
      assert.equal(result.body.report.verdict, "弱支持");
      assert.equal(result.body.context.reportPartial, false);
    },
  );
  await t.test(
    "budget interruption, checkpoint preservation and resume",
    async () => {
      const id = await makeJob({ maxQueries: 1 });
      const svc = mockServices(id);
      await runResearch(id, new AbortController().signal, svc);
      let r = db.prepare("SELECT * FROM jobs WHERE id=?").get(id)!;
      assert.equal(r.queries, 1);
      assert.equal(JSON.parse(String(r.context)).reportPartial, true);
      assert(
        db.prepare("SELECT markdown FROM reports WHERE job_id=?").get(id)
          ?.markdown,
      );
      db.prepare("UPDATE jobs SET status=? WHERE id=?").run("partial", id);
      updateJobBudget(id, {
        maxQueries: 120,
        maxModelCalls: 100,
        maxRunMinutes: 90,
        retryGaps: true,
      });
      controlJob(id, "resume");
      assert.equal(
        db.prepare("SELECT status FROM jobs WHERE id=?").get(id)?.status,
        "queued",
      );
      db.prepare("UPDATE jobs SET status=? WHERE id=?").run("running", id);
      await runResearch(id, new AbortController().signal, svc);
      r = db.prepare("SELECT * FROM jobs WHERE id=?").get(id)!;
      assert.equal(r.queries, 46);
      assert.equal(JSON.parse(String(r.context)).reportPartial, false);
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM stages WHERE job_id=? AND status=?",
          )
          .get(id, "closed")?.n,
        12,
      );
    },
  );
  await t.test(
    "search outage checkpoints retry and config refresh preserves saved material",
    async () => {
      const id = await makeJob();
      const svc = mockServices(id);
      const originalSearch = svc.search;
      svc.search = async () => ({
        hits: [],
        warnings: ["ddg HTTP 202"],
        diagnostics: { engineStats: { ddg: { errors: 1 } } },
      });
      await assert.rejects(
        runResearch(id, new AbortController().signal, svc),
        /待重试查询/,
      );
      let stage = db
        .prepare("SELECT * FROM stages WHERE job_id=? AND stage_id=?")
        .get(id, "identity")!;
      let data = JSON.parse(String(stage.data));
      assert.equal(stage.status, "failed");
      assert.equal(data.searches[0].done, false);
      assert.equal(data.searches[0].retryable, true);
      assert.equal(
        db.prepare("SELECT model_calls FROM jobs WHERE id=?").get(id)
          ?.model_calls,
        1,
      );
      const cutoff = db
        .prepare("SELECT cutoff FROM jobs WHERE id=?")
        .get(id)?.cutoff;
      db.prepare("UPDATE jobs SET status=?,search_config=? WHERE id=?").run(
        "failed",
        JSON.stringify({
          engine: "searchboost",
          engines: ["bing", "ddg", "yahoo"],
        }),
        id,
      );
      const old = await admin.get("/api/jobs/" + id).expect(200);
      assert.equal(old.body.searchConfigChanged, true);
      await admin
        .post("/api/jobs/" + id + "/refresh-search")
        .send({})
        .expect(200);
      const refreshed = await admin.get("/api/jobs/" + id).expect(200);
      assert.equal(refreshed.body.searchConfigChanged, false);
      assert.equal(refreshed.body.cutoff, cutoff);
      assert.equal(refreshed.body.status, "failed");
      assert.equal(
        refreshed.body.stages.find((s: any) => s.stage_id === "identity").data
          .searches.length,
        1,
      );
      svc.search = originalSearch;
      db.prepare("UPDATE jobs SET status=? WHERE id=?").run("running", id);
      await runResearch(id, new AbortController().signal, svc);
      stage = db
        .prepare("SELECT * FROM stages WHERE job_id=? AND stage_id=?")
        .get(id, "identity")!;
      data = JSON.parse(String(stage.data));
      assert.equal(stage.status, "closed");
      assert.equal(data.searches[1].query, data.searches[0].query);
      assert.equal(data.searches[1].done, true);
      assert.equal(
        db.prepare("SELECT queries FROM jobs WHERE id=?").get(id)?.queries,
        47,
      );
      assert(data.claimAudit.decisions.length > 0);
    },
  );
  await t.test(
    "reject unmatched quotations, snippets and future contamination",
    () => {
      const source: Source = {
        id: "s",
        url: "https://example.com",
        domain: "example.com",
        title: "Test",
        text: "The team confirmed an injury before the match starts.",
        snippet: "",
        published: "2025-01-01T00:00:00.000Z",
        fetchedAt: "2025-01-01T00:00:00.000Z",
        status: "read",
        engine: "test",
        tier: "unclassified",
      };
      const claim = {
        claim: "An injury",
        quote: source.text,
        sourceId: "s",
        effect: "neutral" as const,
        kind: "fact" as const,
        confidence: "low" as const,
        limitation: "",
      };
      assert.equal(
        validateClaim(claim, [source], "2025-01-02T00:00:00.000Z"),
        null,
      );
      assert(
        validateClaim(
          { ...claim, quote: "Invented injury evidence here" },
          [source],
          "2025-01-02T00:00:00.000Z",
        ),
      );
      assert(
        validateClaim(
          claim,
          [{ ...source, status: "snippet" }],
          "2025-01-02T00:00:00.000Z",
        ),
      );
      assert(validateClaim(claim, [source], "2024-01-01T00:00:00.000Z"));
      assert(
        validateClaim(
          { ...claim, eventDate: "2028-01-01" },
          [source],
          "2025-01-02T00:00:00.000Z",
        ),
      );
    },
  );
});
