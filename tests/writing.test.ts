import { z } from "zod";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
const directory = mkdtempSync(join(tmpdir(), "touchline-writing-"));
process.env.DATA_DIR = directory;
process.env.APP_SECRET = "a".repeat(64);
process.env.SETUP_TOKEN = "writing-setup";
const { createApp } = await import("../server/app.js");
const { db, uid, passwordHash } = await import("../server/db.js");
const { now } = await import("../server/domain.js");
const { WritingSchema, countScriptChars, lengthTarget, WRITING_SYSTEM } =
  await import("../server/writing/domain.js");
const { initializeWriting, createWriting, writingRun, styles } =
  await import("../server/writing/repository.js");
const { runWriting, cancelWriting } =
  await import("../server/writing/service.js");
const { modelRequest, getProvider } = await import("../server/models.js");
const { writeReport } = await import("../server/research.js");
const app = createApp(),
  admin = request.agent(app),
  viewer = request.agent(app),
  researcher = request.agent(app);
let userId = "",
  providerId = "",
  fixtureId = "",
  jobId = "",
  styleId = "";
const password = "writing-test-password-123";
function input(overrides: any = {}) {
  return WritingSchema.parse({
    supplementSearch: false,
    jobId,
    providerId,
    styleId: styleId || "builtin-evidence",
    durationMinutes: 1,
    charsPerMinute: 240,
    ...overrides,
  });
}
function newRun(overrides: any = {}) {
  return createWriting(input(overrides), userId);
}
const evidenceIds = ["e0", "e1", "e2"];
function fake(options: any = {}) {
  let calls = 0,
    writes = 0;
  const ask: any = async (
    _p: any,
    prompt: string,
    schema: any,
    _signal: any,
    onUsage: any,
    before: any,
    system: string,
  ) => {
    assert.equal(system, WRITING_SYSTEM);
    before?.();
    onUsage?.(10);
    calls++;
    let value: any;
    if (prompt.startsWith("只规划口播"))
      value = {
        title: "测试口播",
        sections: Array.from({ length: options.sections || 1 }, () => ({
          heading: "核心证据",
          focus: "有条件判断",
          evidenceIds,
        })),
      };
    else if (prompt.startsWith("审核以下口播"))
      value = {
        decisions: [
          {
            index: 0,
            supported: !options.disagree,
            reason: options.disagree ? "数字没有对应证据" : "事实已绑定",
          },
        ],
      };
    else {
      writes++;
      value = {
        text: "据".repeat(
          options.short
            ? 80
            : options.repair && writes === 1
              ? 160
              : options.chars || 240,
        ),
        evidenceIds: options.forged ? ["missing"] : evidenceIds,
      };
    }
    if (prompt.startsWith("审核以下口播") && options.sections)
      value.decisions = Array.from(
        { length: options.sections },
        (_, index) => ({ ...value.decisions[0], index }),
      );
    if (prompt.startsWith("只规划口播")) {
      const contract = JSON.stringify(
        z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
      );
      assert(contract.includes("enum"));
      for (const eid of evidenceIds) assert(contract.includes(eid));
    }
    if (options.after) await options.after(calls, prompt);
    return schema.parse(value);
  };
  return {
    ask,
    get calls() {
      return calls;
    },
    get writes() {
      return writes;
    },
  };
}
function supplementFake(options: any = {}) {
  let searchCalls = 0,
    readCalls = 0,
    plans = 0,
    draftRequests = 0;
  const providers: any[] = [];
  const query = (suffix: string) => ({
    query: "主队 官方 阵容 " + suffix,
    intent: "核实阵容是否完整，为用户方向寻找独立佐证",
  });
  const ask: any = async (
    p: any,
    prompt: string,
    schema: any,
    signal: any,
    usage: any,
    before: any,
  ) => {
    before?.();
    usage?.(10);
    providers.push(p);
    let value: any;
    const contract: any = z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
    });
    function ids(o: any): string[] {
      if (!o || typeof o !== "object") return [];
      return [
        ...(o.enum || []).filter(
          (x: any) =>
            typeof x === "string" && (x.startsWith("w-") || /^e[0-2]$/.test(x)),
        ),
        ...Object.values(o).flatMap(ids),
      ];
    }
    const available = [...new Set(ids(contract))];
    if (prompt.startsWith("写作补搜计划")) {
      plans++;
      value = {
        needsSearch: plans === 1 && !options.noSearch,
        reason: "阵容缺少官方佐证，优先核实",
        gaps: ["当前阵容"],
        queries: plans === 1 && !options.noSearch ? [query("写前")] : [],
      };
    } else if (prompt.startsWith("补搜提取")) {
      const context = JSON.parse(prompt.slice(prompt.indexOf("{")));
      value = {
        claims: [
          {
            claim: "主队训练阵容完整",
            quote: options.forged
              ? "这是完全不存在于网页当中的一段虚构原文"
              : context.source.text,
            eventDate: options.futureEvent ? "2099-01-01" : null,
            effect: "supports",
            directionReason: "阵容完整是有条件的支持",
            limitation: "不等于获胜",
          },
        ],
      };
      if (options.abortExtract) {
        options.abortExtract();
        options.abortExtract = undefined;
      }
    } else if (prompt.startsWith("补搜核验")) {
      value = {
        decisions: options.omitAudit
          ? []
          : [
              {
                index: 0,
                supported: !options.reject,
                reason: options.reject
                  ? "对象不是同一年龄组"
                  : "上下文及对象吻合",
              },
            ],
      };
    } else if (prompt.startsWith("只规划口播")) {
      value = {
        title: "补搜写作测试",
        sections: [
          {
            heading: "核心依据",
            focus: "阵容稳定但有条件",
            evidenceIds: available.slice(-3),
          },
        ],
      };
    } else if (prompt.startsWith("审核以下口播")) {
      value = {
        decisions: [{ index: 0, supported: true, reason: "已核实所有事实" }],
      };
    } else if (
      contract.properties?.searchRequests &&
      !options.noMid &&
      draftRequests++ === 0
    ) {
      value = { text: "", evidenceIds: [], searchRequests: [query("写中")] };
    } else
      value = {
        text: "据".repeat(240),
        evidenceIds: available.slice(-1),
        ...(contract.properties?.searchRequests ? { searchRequests: [] } : {}),
      };
    return schema.parse(value);
  };
  const tools: any = {
    search: async (_query: string, _cfg: any, signal: AbortSignal) => {
      searchCalls++;
      if (options.abortSearch) {
        options.abortSearch();
        options.abortSearch = undefined;
        signal.throwIfAborted();
      }
      if (options.fail) throw new Error("bing challenge / yahoo http 500");
      return {
        hits: options.empty
          ? []
          : [
              {
                url: "https://official.example/article-" + searchCalls,
                title: "球队官方训练公告",
                snippet: "",
                published: "2026-01-01",
                engine: "test",
              },
            ],
        warnings: options.partial ? ["备用引擎不可达"] : [],
      };
    },
    read: async (hit: any, _cfg: any, cutoff: string) => {
      readCalls++;
      assert(Number.isFinite(Date.parse(cutoff)));
      return {
        id: "supplement-source-" + readCalls,
        ...hit,
        domain: "official.example",
        status: options.readFail ? "failed" : "read",
        published: options.postCutoff
          ? "2099-01-01"
          : options.unknownDate
            ? null
            : "2026-01-01",
        text: "主队官方训练公告确认全部报名球员正常参与合练，教练称仍需关注赛前变化。",
        fetchedAt: now(),
        tier: "official_or_trusted",
      };
    },
  };
  return {
    ask,
    tools,
    providers,
    get searchCalls() {
      return searchCalls;
    },
    get readCalls() {
      return readCalls;
    },
  };
}
after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
test("independent writing module", async (t) => {
  await t.test("authenticated setup and empty writing queue", async () => {
    await request(app).get("/api/writing/styles").expect(401);
    await admin
      .post("/api/auth/setup")
      .send({ username: "admin", password, setupToken: "writing-setup" })
      .expect(201);
    const login = await admin
      .post("/api/auth/login")
      .send({ username: "admin", password })
      .expect(200);
    userId = login.body.user.id;
    for (const role of ["viewer", "researcher"])
      db.prepare(
        "INSERT INTO users(id,username,password,role,created_at) VALUES(?,?,?,?,?)",
      ).run(uid(), role, passwordHash(password), role, now());
    await viewer
      .post("/api/auth/login")
      .send({ username: "viewer", password })
      .expect(200);
    await researcher
      .post("/api/auth/login")
      .send({ username: "researcher", password })
      .expect(200);
    const p = await admin
      .post("/api/providers")
      .send({
        name: "writer",
        type: "openai",
        baseUrl: "http://127.0.0.1:65530/v1",
        model: "test",
        apiKey: "do-not-export",
      })
      .expect(201);
    providerId = p.body.id;
    fixtureId = uid();
    const fixture = {
      home: "甲",
      away: "乙",
      league: "测试",
      kickoff: "2099-01-01T00:00:00Z",
    };
    db.prepare("INSERT INTO fixtures VALUES(?,?,?)").run(
      fixtureId,
      JSON.stringify(fixture),
      now(),
    );
    jobId = uid();
    db.prepare(
      "INSERT INTO jobs(id,fixture_id,fixture,direction,line,provider_id,status,config,search_config,created_by,created_at,cutoff,run_after) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      jobId,
      fixtureId,
      JSON.stringify(fixture),
      "主队守住底线",
      "",
      providerId,
      "completed",
      "{}",
      "{}",
      userId,
      now(),
      "2098-01-01T00:00:00Z",
      now(),
    );
    db.prepare(
      "INSERT INTO reports(job_id,markdown,verdict,confidence,created_at) VALUES(?,?,?,?,?)",
    ).run(jobId, "有条件支持；需要复核阵容。", "弱支持", "medium", now());
    for (let i = 0; i < 3; i++) {
      const source = {
        id: "s" + i,
        url: "https://source" + (i % 2) + ".example/" + i,
        domain: "source" + (i % 2) + ".example",
        title: "原文" + i,
        text: "主队近期保持稳定，人员仍需复核。" + i,
        status: "read",
        published: "2026-09-20T00:00:00Z",
      };
      db.prepare("INSERT INTO sources VALUES(?,?,?,?)").run(
        source.id,
        jobId,
        source.url,
        JSON.stringify(source),
      );
      db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?)").run(
        "e" + i,
        jobId,
        "identity",
        source.id,
        JSON.stringify({
          id: "e" + i,
          sourceId: source.id,
          quote: source.text,
          claim: "表现稳定，阵容未知",
          effect: "supports",
          kind: "fact",
        }),
      );
    }
    assert.equal((await admin.get("/api/writing/runs")).body.length, 0);
    assert.equal((await admin.get("/api/writing/materials")).body.length, 1);
    assert.equal((await admin.get("/api/writing/styles")).body.length, 3);
    await viewer.post("/api/writing/runs").send(input()).expect(403);
    await researcher.post("/api/writing/styles").send({}).expect(403);
  });
  await t.test(
    "style and knowledge CRUD with independent immutable snapshots",
    async () => {
      const value = {
        name: "自定义",
        description: "测试结构",
        instructions: "角色指令：简洁说明证据与成立条件，不编造事实。",
        charsPerMinute: 220,
        enabled: true,
      };
      const created = await admin
        .post("/api/writing/styles")
        .send(value)
        .expect(201);
      styleId = created.body.id;
      const k = await admin
        .post("/api/writing/styles/" + styleId + "/knowledge")
        .send({ title: "开头范式", content: "先提问题，再解释证据。" })
        .expect(201);
      const started = await admin
        .post("/api/writing/runs")
        .send(input())
        .expect(201);
      const frozen = writingRun(started.body.id);
      assert.equal(frozen.status, "queued");
      assert.equal(frozen.input.knowledge[0].content, "先提问题，再解释证据。");
      assert.equal(frozen.input.style.name, "自定义");
      assert(!JSON.stringify(frozen).includes("do-not-export"));
      await admin
        .put("/api/writing/styles/" + styleId)
        .send({ ...value, name: "新名字" })
        .expect(200);
      await admin
        .put("/api/writing/knowledge/" + k.body.id)
        .send({ title: "新范式", content: "新的内容", enabled: false })
        .expect(200);
      assert.equal(writingRun(frozen.id).input.style.name, "自定义");
      assert.equal(writingRun(frozen.id).input.knowledge[0].title, "开头范式");
      await admin.delete("/api/writing/knowledge/" + k.body.id).expect(200);
      await admin.delete("/api/writing/styles/" + styleId).expect(200);
      assert.equal(writingRun(frozen.id).style_id, null);
      assert.equal(writingRun(frozen.id).input.style.id, styleId);
      await runWriting(frozen.id, new AbortController().signal, fake().ask);
      assert.equal(writingRun(frozen.id).status, "completed");
      initializeWriting();
      assert(!styles().some((s) => s.id === styleId));
      styleId = "builtin-evidence";
      const huge = {
        title: "结构资料",
        content: "字".repeat(10000),
        enabled: true,
      };
      const a = await admin
        .post("/api/writing/styles/" + styleId + "/knowledge")
        .send(huge)
        .expect(201);
      const b = await admin
        .post("/api/writing/styles/" + styleId + "/knowledge")
        .send(huge)
        .expect(201);
      await admin
        .post("/api/writing/styles/" + styleId + "/knowledge")
        .send({ title: "溢出", content: "字" })
        .expect(400);
      await admin.delete("/api/writing/knowledge/" + a.body.id).expect(200);
      await admin.delete("/api/writing/knowledge/" + b.body.id).expect(200);
    },
  );
  await t.test(
    "timing math, validation and completed evidence boundary",
    async () => {
      assert.equal(countScriptChars("中 文，abc 123！"), 8);
      assert.deepEqual(lengthTarget(3, 240), {
        target: 720,
        min: 648,
        max: 792,
      });
      for (const duration of [0, 31])
        assert.throws(() => input({ durationMinutes: duration }));
      db.prepare("UPDATE jobs SET status=? WHERE id=?").run("running", jobId);
      assert.throws(() => newRun(), /仍在运行/);
      db.prepare("UPDATE jobs SET status=? WHERE id=?").run("completed", jobId);
      const original = db
        .prepare("SELECT data FROM evidence WHERE id=?")
        .get("e0")!.data;
      db.prepare("UPDATE evidence SET data=? WHERE id=?").run(
        JSON.stringify({ quote: "虚构引语" }),
        "e0",
      );
      assert.throws(() => newRun(), /三条/);
      db.prepare("UPDATE evidence SET data=? WHERE id=?").run(original, "e0");
      const missing = uid();
      await admin
        .post("/api/writing/runs")
        .send(input({ jobId: missing }))
        .expect(409);
    },
  );
  await t.test(
    "manual writing stays separate from research and uses custom system across protocols",
    async () => {
      const before = db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId);
      const report = db
        .prepare("SELECT * FROM reports WHERE job_id=?")
        .get(jobId);
      const id = newRun(),
        svc = fake();
      await runWriting(id, new AbortController().signal, svc.ask);
      const r = writingRun(id);
      assert.equal(r.status, "completed");
      assert.equal(r.character_count, 240);
      assert.equal(r.model_calls, 3);
      assert.equal(r.tokens, 30);
      assert.equal(r.input.target.target, 240);
      assert.equal(r.progress.audit.decisions.length, 1);
      assert.deepEqual(
        db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId),
        before,
      );
      assert.deepEqual(
        db.prepare("SELECT * FROM reports WHERE job_id=?").get(jobId),
        report,
      );
      for (const type of [
        "openai",
        "responses",
        "anthropic",
        "gemini",
        "ollama",
      ] as const) {
        const req = modelRequest(
          { ...getProvider(providerId), type },
          "draft",
          WRITING_SYSTEM,
        );
        assert(JSON.stringify(req.body).includes(WRITING_SYSTEM));
        assert(!JSON.stringify(req.body).includes("严谨的足球赛前研究员"));
      }
      await viewer.get("/api/writing/runs/" + id).expect(200);
      await researcher
        .post("/api/writing/runs/" + id + "/cancel")
        .send({})
        .expect(403);
      const plain = await admin
        .get("/api/writing/runs/" + id + "/export?format=txt")
        .expect(200);
      assert.equal(plain.text, r.content);
      const md = await admin
        .get("/api/writing/runs/" + id + "/export")
        .expect(200);
      assert.match(md.text, /证据绑定/);
      assert.match(md.text, /source0.example/);
      await admin
        .get("/api/writing/runs/" + id + "/export?format=bad")
        .expect(400);
      const snap = await admin
        .get("/api/writing/runs/" + id + "/export?format=json")
        .expect(200);
      assert.equal(snap.body.input.evidence.length, 3);
      assert(!JSON.stringify(snap.body).includes("do-not-export"));
    },
  );
  await t.test(
    "one bounded length repair and failed length or evidence audit stays reviewable",
    async () => {
      const id = newRun(),
        svc = fake({ repair: true });
      await runWriting(id, new AbortController().signal, svc.ask);
      assert.equal(writingRun(id).status, "completed");
      assert.equal(svc.writes, 2);
      const short = newRun(),
        shortSvc = fake({ short: true });
      await runWriting(short, new AbortController().signal, shortSvc.ask);
      assert.equal(writingRun(short).status, "needs_review");
      assert.equal(writingRun(short).character_count, 80);
      assert.match(writingRun(short).progress.issues[0], /未达到/);
      assert.equal(shortSvc.writes, 2);
      const doubtful = newRun();
      await runWriting(
        doubtful,
        new AbortController().signal,
        fake({ disagree: true }).ask,
      );
      assert.equal(writingRun(doubtful).status, "needs_review");
      assert.match(writingRun(doubtful).progress.issues[0], /数字/);
      const forged = newRun();
      await runWriting(
        forged,
        new AbortController().signal,
        fake({ forged: true }).ask,
      );
      assert.equal(writingRun(forged).status, "failed");
      assert.equal(writingRun(forged).content, "");
    },
  );
  await t.test(
    "long scripts distribute length across first middle and last paragraphs",
    async () => {
      const id = newRun({ durationMinutes: 7.5 }),
        svc = fake({ sections: 3, chars: 600 });
      await runWriting(id, new AbortController().signal, svc.ask);
      const r = writingRun(id);
      assert.equal(r.status, "completed");
      assert.equal(r.character_count, 1800);
      assert.equal(r.progress.paragraphs.length, 3);
      assert.equal(r.progress.audit.decisions.length, 3);
      assert.equal(r.model_calls, 5);
      assert(
        r.progress.paragraphs.every(
          (p: any) => countScriptChars(p.text) === 600,
        ),
      );
    },
  );
  await t.test(
    "cancellation and checkpoint resume never silently restart research",
    async () => {
      const id = newRun();
      const svc = fake({
        after: (n: number) => {
          if (n === 2) cancelWriting(id);
        },
      });
      await runWriting(id, new AbortController().signal, svc.ask);
      assert.equal(writingRun(id).status, "cancelled");
      assert.equal(writingRun(id).content, "");
      assert.equal(svc.calls, 2);
      const resumed = newRun(),
        controller = new AbortController();
      const interrupted = fake({
        after: (n: number) => {
          if (n === 3) controller.abort();
        },
      });
      await runWriting(resumed, controller.signal, interrupted.ask);
      assert.equal(writingRun(resumed).status, "queued");
      assert.equal(writingRun(resumed).progress.paragraphs.length, 1);
      assert.equal(writingRun(resumed).model_calls, 3);
      const finish = fake();
      await runWriting(resumed, new AbortController().signal, finish.ask);
      assert.equal(finish.calls, 1);
      assert.equal(writingRun(resumed).status, "completed");
      assert.equal(writingRun(resumed).model_calls, 4);
      const budget = newRun();
      db.prepare("UPDATE writing_runs SET model_calls=999 WHERE id=?").run(
        budget,
      );
      await runWriting(budget, new AbortController().signal, fake().ask);
      assert.equal(writingRun(budget).status, "failed");
      assert.match(writingRun(budget).error, /预算/);
    },
  );
  await t.test(
    "writing plans and searches before and during drafting, keeps research immutable, and applies native thinking",
    async () => {
      const before = ["jobs", "sources", "evidence", "reports"].map((name) =>
        db.prepare("SELECT * FROM " + name).all(),
      );
      const settings = {
        mode: "enabled",
        effort: "low",
        adapter: "openai",
        budgetTokens: 2048,
      };
      const id = newRun({ supplementSearch: true, thinking: settings });
      const frozen = writingRun(id).input;
      assert(frozen.supplementCutoff <= now());
      const f = supplementFake();
      await runWriting(id, new AbortController().signal, f.ask, f.tools);
      const r = writingRun(id);
      assert.equal(r.status, "completed", r.error);
      assert.equal(f.searchCalls, 2);
      assert.equal(f.readCalls, 2);
      assert.equal(r.progress.supplement.evidence.length, 2);
      assert(r.progress.paragraphs[0].evidenceIds[0].startsWith("w-"));
      assert.deepEqual(r.input, frozen);
      assert.deepEqual(
        ["jobs", "sources", "evidence", "reports"].map((name) =>
          db.prepare("SELECT * FROM " + name).all(),
        ),
        before,
      );
      assert(f.providers.every((p) => p.thinking.effort === "low"));
      assert.equal(
        (modelRequest(f.providers[0], "test", WRITING_SYSTEM).body as any)
          .reasoning_effort,
        "low",
      );
      const detail = await admin.get("/api/writing/runs/" + id).expect(200);
      const exported = await admin
        .get("/api/writing/runs/" + id + "/export?format=json")
        .expect(200);
      assert(!JSON.stringify(detail.body).includes("credentialId"));
      assert(!JSON.stringify(exported.body).includes("credentialId"));
      assert(!JSON.stringify(exported.body).includes("do-not-export"));
      const md = await admin
        .get("/api/writing/runs/" + id + "/export?format=md")
        .expect(200);
      assert(md.text.includes("写作补搜"));
      assert(md.text.includes("official.example/article-2"));
      await admin
        .post("/api/writing/runs")
        .send(input({ thinking: { ...settings, adapter: "gemini-level" } }))
        .expect(400);
    },
  );
  await t.test(
    "writing supplements reject invalid quotations, future facts, post-cutoff pages and failed semantic audits",
    async () => {
      for (const options of [
        { forged: true },
        { futureEvent: true },
        { postCutoff: true },
        { reject: true },
        { readFail: true },
      ]) {
        const id = newRun({ supplementSearch: true });
        const f = supplementFake({ ...options, noMid: true });
        await runWriting(id, new AbortController().signal, f.ask, f.tools);
        const r = writingRun(id);
        assert.equal(
          r.status,
          "needs_review",
          JSON.stringify({ options, error: r.error }),
        );
        assert.equal(r.progress.supplement.evidence.length, 0);
        assert(r.progress.supplement.warnings.length > 0);
      }
      const id = newRun({ supplementSearch: true });
      const f = supplementFake({ omitAudit: true });
      await runWriting(id, new AbortController().signal, f.ask, f.tools);
      assert.equal(writingRun(id).status, "failed");
      assert.equal(writingRun(id).progress.supplement.evidence.length, 0);
    },
  );
  await t.test(
    "search failures, unknown publication dates and partial engine failures remain visible",
    async () => {
      for (const options of [
        { fail: true },
        { empty: true },
        { partial: true },
        { unknownDate: true },
      ]) {
        const id = newRun({ supplementSearch: true });
        const f = supplementFake({ ...options, noMid: true });
        await runWriting(id, new AbortController().signal, f.ask, f.tools);
        const r = writingRun(id);
        assert.equal(
          r.status,
          "needs_review",
          JSON.stringify({ options, error: r.error }),
        );
        assert(r.content);
        assert(r.progress.issues.length);
      }
      const id = newRun({ supplementSearch: true, maxSupplementQueries: 1 });
      const f = supplementFake();
      await runWriting(id, new AbortController().signal, f.ask, f.tools);
      assert.equal(f.searchCalls, 1);
      assert.equal(writingRun(id).status, "completed");
      const noSearchId = newRun({ supplementSearch: true });
      const g = supplementFake({ noSearch: true, noMid: true });
      await runWriting(
        noSearchId,
        new AbortController().signal,
        g.ask,
        g.tools,
      );
      assert.equal(g.searchCalls, 0);
      assert.equal(writingRun(noSearchId).status, "completed");
    },
  );
  await t.test(
    "supplement checkpoints resume without duplicate completed searches or page reads",
    async () => {
      for (const phase of ["abortSearch", "abortExtract"]) {
        const id = newRun({ supplementSearch: true });
        const controller = new AbortController();
        const f = supplementFake({
          noMid: true,
          [phase]: () => controller.abort(),
        });
        await runWriting(id, controller.signal, f.ask, f.tools);
        assert.equal(writingRun(id).status, "queued");
        await runWriting(id, new AbortController().signal, f.ask, f.tools);
        assert.equal(f.searchCalls, 1);
        assert.equal(f.readCalls, phase === "abortSearch" ? 0 : 1);
        assert.equal(
          writingRun(id).status,
          phase === "abortSearch" ? "needs_review" : "completed",
          writingRun(id).error,
        );
      }
    },
  );
  await t.test(
    "legacy scripts import once and survive report regeneration and source deletion",
    async () => {
      db.prepare("UPDATE reports SET script=? WHERE job_id=?").run(
        "历史口播稿",
        jobId,
      );
      db.prepare("DELETE FROM writing_meta WHERE key=?").run("legacy_scripts");
      initializeWriting();
      initializeWriting();
      const legacy = writingRun("legacy-" + jobId);
      assert.equal(legacy.content, "历史口播稿");
      assert.equal(legacy.status, "needs_review");
      writeReport(jobId, null, "重新生成研究报告");
      assert.equal(
        db.prepare("SELECT script FROM reports WHERE job_id=?").get(jobId)
          ?.script,
        "历史口播稿",
      );
      assert.equal(writingRun(legacy.id).content, "历史口播稿");
      const id = newRun();
      await admin.delete("/api/writing/runs/" + id).expect(409);
      await admin
        .post("/api/writing/runs/" + id + "/cancel")
        .send({})
        .expect(200);
      await admin.delete("/api/writing/runs/" + id).expect(200);
      await admin.get("/api/writing/runs/" + id).expect(404);
      const other = await admin
        .post("/api/providers")
        .send({
          name: "writing-only",
          type: "openai",
          baseUrl: "http://127.0.0.1:65530/v1",
          model: "test",
        })
        .expect(201);
      const preserved = newRun({ providerId: other.body.id });
      cancelWriting(preserved);
      await admin.delete("/api/providers/" + other.body.id).expect(409);
      db.prepare("UPDATE jobs SET status=? WHERE id=?").run("completed", jobId);
      await admin.delete("/api/jobs/" + jobId).expect(200);
      assert.equal(writingRun(preserved).job_id, null);
      assert.equal(writingRun(preserved).input.evidence.length, 3);
    },
  );
});
