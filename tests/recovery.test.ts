import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { load as html } from "cheerio";
import { z } from "zod";
import type { Provider } from "../server/domain.js";
const directory = mkdtempSync(join(tmpdir(), "touchline-recovery-"));
process.env.DATA_DIR = directory;
process.env.APP_SECRET = "c".repeat(64);
process.env.SETUP_TOKEN = "recovery-setup-token";
const { complete, completeJson } = await import("../server/models.js");
const {
  acceptedClaimIndexes,
  restoreSearchCheckpoints,
  latestCompletedSearch,
} = await import("../server/research.js");
const { publicationTime, articlePublication } =
  await import("../server/publication.js");
const { db } = await import("../server/db.js");
after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

test("failed research regression cases", async (t) => {
  let mode = "",
    calls = 0;
  const prompts: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    calls++;
    prompts.push(body.input);
    if (mode === "disconnect" && calls === 1) {
      req.socket.destroy();
      return;
    }
    if (mode === "timeout" && calls === 1) {
      setTimeout(() => res.end("{}"), 250).unref();
      return;
    }
    if (
      mode === "auth" ||
      (["transient", "budget", "abort", "long-wait"].includes(mode) &&
        calls === 1) ||
      mode === "exhaust"
    ) {
      res.statusCode =
        mode === "auth"
          ? 401
          : mode === "long-wait" || mode === "abort"
            ? 429
            : 503;
      if (mode === "long-wait") res.setHeader("Retry-After", "120");
      res.end("{}");
      return;
    }
    const value =
      mode === "repair"
        ? {
            issues:
              calls === 1
                ? [{ issue: "韩国材料被归到中国", sourceId: "source-1" }]
                : ["韩国材料被归到中国；sourceId: source-1"],
            gaps: [],
            followups: [{ query: "中国女足 赛程 2026", reason: "核对主体" }],
          }
        : { ok: true };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        output_text: JSON.stringify(value),
        usage: { total_tokens: 12 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const provider: Provider = {
    id: "test",
    name: "test",
    type: "responses",
    model: "test",
    baseUrl: "http://127.0.0.1:" + (server.address() as any).port,
    secret: "test-secret-never-log",
    enabled: true,
    timeoutSeconds: 10,
    maxTokens: 1000,
  };
  const begin = (next: string) => {
    mode = next;
    calls = 0;
    prompts.length = 0;
  };
  try {
    await t.test(
      "503 and disconnected upstream retry once, counting each actual request",
      async () => {
        for (const type of ["transient", "disconnect"]) {
          begin(type);
          let counted = 0;
          assert.equal(
            JSON.parse(
              (await complete(provider, "prompt", undefined, () => counted++))
                .text,
            ).ok,
            true,
          );
          assert.equal(counted, 2);
          assert.equal(calls, 2);
        }
      },
    );
    await t.test(
      "timeouts retry once and exhausted errors are actionable",
      async () => {
        begin("timeout");
        await complete({ ...provider, timeoutSeconds: 0.08 }, "prompt");
        assert.equal(calls, 2);
        begin("exhaust");
        await assert.rejects(
          complete(provider, "prompt"),
          /自动重试后仍失败.*HTTP 503/,
        );
        assert.equal(calls, 2);
      },
    );
    await t.test("auth errors and long rate limits do not retry", async () => {
      for (const type of ["auth", "long-wait"]) {
        begin(type);
        await assert.rejects(complete(provider, "prompt"), /HTTP (401|429)/);
        assert.equal(calls, 1);
      }
    });
    await t.test(
      "budget and cancellation block the retry request",
      async () => {
        begin("budget");
        let count = 0;
        await assert.rejects(
          complete(provider, "prompt", undefined, () => {
            if (++count > 1) throw new Error("budget exhausted");
          }),
          /budget exhausted/,
        );
        assert.equal(calls, 1);
        begin("abort");
        const signal = AbortSignal.timeout(80);
        await assert.rejects(complete(provider, "prompt", signal));
        assert.equal(calls, 1);
      },
    );
    await t.test(
      "actual audit mismatch repairs only previous JSON, with explicit schema",
      async () => {
        begin("repair");
        let tokens = 0;
        const schema = z.object({
          issues: z.array(z.string()),
          gaps: z.array(z.string()),
          followups: z
            .array(z.object({ query: z.string(), reason: z.string() }))
            .min(1),
        });
        const result = await completeJson(
          provider,
          "FULL_SOURCE_PACK_MARKER" + "原文".repeat(5000),
          schema,
          undefined,
          (n) => {
            tokens += n;
          },
        );
        assert.equal(calls, 2);
        assert.equal(tokens, 24);
        assert.match(prompts[0], /JSON Schema/);
        assert(!prompts[1].includes("FULL_SOURCE_PACK_MARKER"));
        assert(prompts[1].includes("source-1"));
        assert.match(result.issues[0], /韩国材料/);
        assert(prompts[1].length < prompts[0].length / 2);
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  await t.test(
    "restoring checkpoints uses latest successful sources and keeps genuine zero hits complete",
    () => {
      const state: any = {
        searches: [
          { query: "retry", sourceIds: [], warnings: ["HTTP 202"], done: true },
          {
            query: "retry",
            sourceIds: ["new-source"],
            warnings: [],
            done: true,
            retryable: false,
          },
          {
            query: "empty-success",
            sourceIds: [],
            warnings: ["本次搜索没有可用结果"],
            done: true,
            retryable: false,
          },
        ],
        followups: [{ query: "retry", done: true }],
      };
      restoreSearchCheckpoints(state);
      assert.equal(state.searches[0].done, false);
      assert.equal(state.followups[0].done, true);
      assert.equal(state.searches[2].done, true);
      assert.deepEqual(latestCompletedSearch(state, "retry").sourceIds, [
        "new-source",
      ]);
    },
  );
  await t.test(
    "publication metadata respects timezones, article scope and unknown precision",
    () => {
      const cctv = "https://sports.cctv.com/2026/09/29/article.shtml";
      const before = publicationTime("2026年09月29日 07:22:00", cctv);
      assert.equal(before.published, "2026-09-28T23:22:00.000Z");
      assert(before.published! < "2026-09-29T03:42:03.190Z");
      assert.equal(
        publicationTime("2026-09-29 07:22", "https://example.com/a").published,
        null,
      );
      assert.equal(publicationTime("2026-09-29", cctv).published, null);
      assert.equal(
        publicationTime("2026-02-30T07:22:00Z", cctv).published,
        null,
      );
      const article = html(
        "<script type=application/ld+json>" +
          JSON.stringify({
            "@graph": [
              { "@type": "WebSite", datePublished: "2026-01-01T00:00:00Z" },
              {
                "@type": "NewsArticle",
                datePublished: "2026-09-29T12:30:00+09:00",
              },
            ],
          }) +
          "</script>",
      );
      assert.equal(
        articlePublication(article, "https://olympics.com/article").published,
        "2026-09-29T03:30:00.000Z",
      );
      assert.equal(
        articlePublication(
          html("<div class=info>来源：央视网 2026年09月29日 07:22:00</div>"),
          cctv,
        ).published,
        before.published,
      );
      assert.equal(
        articlePublication(
          html(
            "<meta property=article:modified_time content=2026-09-29T16:00:00Z><time datetime=2026-09-29T17:00:00Z>Kickoff</time>",
          ),
          cctv,
        ).published,
        null,
      );
    },
  );
  await t.test(
    "claim audit rejects omissions, duplicate votes and wrong source bindings",
    () => {
      const claims = [
        { sourceId: "s0" },
        { sourceId: "s1" },
        { sourceId: "s2" },
        { sourceId: "s3" },
        { sourceId: "s4" },
      ];
      const decisions: any[] = [
        {
          index: 0,
          sourceId: "s0",
          verdict: "supported",
          reason: "同队同组别",
        },
        {
          index: 1,
          sourceId: "s1",
          verdict: "unsupported",
          reason: "原文是韩国，主张是中国",
        },
        { index: 2, sourceId: "wrong", verdict: "supported", reason: "wrong" },
        { index: 3, sourceId: "s3", verdict: "supported", reason: "first" },
        { index: 3, sourceId: "s3", verdict: "supported", reason: "duplicate" },
      ];
      assert.deepEqual([...acceptedClaimIndexes(claims, { decisions })], [0]);
    },
  );
});
