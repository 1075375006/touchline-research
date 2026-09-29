import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import request from "supertest";
// @ts-expect-error Shared plain-JavaScript module also runs in the native worker.
import { searchFailure } from "../server/search-resilience.mjs";
const directory = mkdtempSync(join(tmpdir(), "touchline-search-test-"));
process.env.DATA_DIR = directory;
process.env.APP_SECRET = "b".repeat(64);
process.env.SETUP_TOKEN = "search-test-setup";
const { createApp } = await import("../server/app.js");
const { db, searchConfig, unseal } = await import("../server/db.js");
const { SearchSchema, SEARCH_API_NAMES } = await import("../server/domain.js");
const { publicSearchConfig } = await import("../server/search-config.js");
const { searchTool, closeSearchRuntimes } =
  await import("../server/search-runtime.js");
const { searchWeb } = await import("../server/search.js");
const calls: any[] = [];
const gateway = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const name = url.pathname.split("/")[2];
  calls.push({
    name,
    path: url.pathname,
    headers: req.headers,
    body,
    query: Object.fromEntries(url.searchParams),
  });
  res.setHeader("content-type", "application/json");
  if (name === "jev") {
    res.statusCode = 401;
    res.end(
      JSON.stringify({
        error: "invalid_api_key",
        message: req.headers.authorization,
      }),
    );
    return;
  }
  const query = body.query || url.searchParams.get("q");
  const seen = calls.filter(
    (c) => (c.body.query || c.query.q) === query,
  ).length;
  const seenForEngine = calls.filter(
    (c) => c.name === name && (c.body.query || c.query.q) === query,
  ).length;
  if (
    query === "network-exhaust" ||
    ((query === "network-recover" || query === "network-cancel") &&
      seen === 1) ||
    (["network-mixed", "network-partial"].includes(query) &&
      name === "tavily" &&
      seenForEngine === 1)
  ) {
    req.socket.destroy();
    return;
  }
  if (
    query === "network-auth" ||
    (query === "network-mixed" && name === "brave") ||
    (query === "network-503" && seen === 1)
  ) {
    res.statusCode = query === "network-503" ? 503 : 401;
    res.end(JSON.stringify({ error: "test upstream failure" }));
    return;
  }
  if (query === "network-empty") {
    res.end(JSON.stringify({ results: [] }));
    return;
  }
  const hit = {
    url: "https://" + name + ".example/team-news",
    title: name + " official team news",
    content:
      "The club confirms two players returned to full training before the match.",
    snippet: "Official team training update.",
    description: "Official team training update.",
    text: "The club confirms two players returned to full training before the match.",
    publishedDate: "2026-09-01",
  };
  const data =
    name === "brave"
      ? { web: { results: [hit] } }
      : name === "anysearch"
        ? { code: 0, data: { results: [hit] } }
        : { results: [hit] };
  if (query === "cancel-flight") await new Promise((r) => setTimeout(r, 1500));
  res.end(JSON.stringify(data));
});
await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + (gateway.address() as any).port;
const admin = request.agent(createApp());
const key = (name: string) => "test-private-" + name + "-key";
async function save(config: any) {
  return admin.put("/api/settings/search").send(config);
}
after(async () => {
  closeSearchRuntimes();
  gateway.closeAllConnections();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
test("SearchBoost API integration and isolated credentials", async (t) => {
  await admin
    .post("/api/auth/setup")
    .send({
      username: "admin",
      password: "test-search-admin-123",
      setupToken: "search-test-setup",
    })
    .expect(201);
  await admin
    .post("/api/auth/login")
    .send({ username: "admin", password: "test-search-admin-123" })
    .expect(200);
  await t.test(
    "legacy defaults and encrypted write-only search credentials",
    async () => {
      const legacy = SearchSchema.parse({
        engine: "searchboost",
        engines: ["bing", "ddg", "yahoo"],
      });
      assert.equal(legacy.enginePool, "free");
      assert.equal(legacy.strategy, "fused");
      assert.equal(legacy.reader, "direct");
      const config: any = publicSearchConfig(searchConfig());
      Object.assign(config, {
        engine: "searchboost-api",
        enginePool: "api",
        depth: "advanced",
        recency: "week",
        excludeDomains: [],
      });
      for (const name of SEARCH_API_NAMES)
        Object.assign(config.apiProviders[name], {
          enabled: true,
          baseUrl: origin + "/gateway/" + name,
          apiKey: key(name),
        });
      (await (await save(config)).status) === 200;
      assert.equal(searchConfig().enginePool, "api");
      const response = await admin.get("/api/settings").expect(200);
      for (const name of SEARCH_API_NAMES) {
        assert.equal(response.body.search.apiProviders[name].hasKey, true);
        assert(!JSON.stringify(response.body).includes(key(name)));
        assert(!JSON.stringify(response.body.search).includes("credentialId"));
        const row = db
          .prepare("SELECT secret FROM search_credentials WHERE id=?")
          .get(searchConfig().apiProviders[name].credentialId)!;
        assert.notEqual(row.secret, key(name));
        assert.equal(unseal(String(row.secret)), key(name));
      }
      const before = searchConfig().apiProviders.tavily.credentialId;
      (await (await save(response.body.search)).status) === 200;
      assert.equal(searchConfig().apiProviders.tavily.credentialId, before);
    },
  );
  await t.test(
    "four search APIs preserve gateway prefix, auth and cache",
    async () => {
      const result = await searchWeb("match training", searchConfig());
      assert.equal(result.hits.length, 4, JSON.stringify(result));
      assert.deepEqual(
        new Set(result.diagnostics.enginesUsed),
        new Set(SEARCH_API_NAMES),
      );
      const call = (name: string) => calls.find((c) => c.name === name);
      assert.equal(call("tavily").body.api_key, key("tavily"));
      assert.equal(call("tavily").body.search_depth, "advanced");
      assert.equal(call("brave").headers["x-subscription-token"], key("brave"));
      assert.equal(call("brave").path, "/gateway/brave/web/search");
      assert.equal(call("exa").headers["x-api-key"], key("exa"));
      assert(call("exa").body.startPublishedDate);
      assert.equal(
        call("anysearch").headers.authorization,
        "Bearer " + key("anysearch"),
      );
      const count = calls.length;
      await searchWeb("match training", searchConfig());
      assert.equal(calls.length, count, "same config uses native cache");
    },
  );
  await t.test(
    "free AnySearch omits paid credentials and honors exclusions",
    async () => {
      const config: any = structuredClone(searchConfig());
      Object.assign(config, {
        engine: "searchboost",
        enginePool: "free",
        engines: ["anysearch"],
        excludeDomains: ["anysearch.example"],
      });
      const from = calls.length,
        result = await searchWeb("free training", config);
      const call = calls.slice(from).find((c) => c.name === "anysearch");
      assert(call);
      assert.equal(call.headers.authorization, undefined);
      assert.equal(result.hits.length, 0);
    },
  );
  await t.test(
    "native layer aliases, domain filters and permission boundaries",
    async () => {
      const cfg = searchConfig(),
        from = calls.length;
      await searchTool(
        "fused_search",
        { query: "alias-free", layer: "free", engines: ["anysearch"] },
        cfg,
      );
      await searchTool(
        "fused_search",
        { query: "alias-api", layer: "api", engines: ["anysearch"] },
        cfg,
      );
      const sent = calls.slice(from).filter((c) => c.name === "anysearch");
      assert.equal(sent[0].headers.authorization, undefined);
      assert.equal(sent[1].headers.authorization, "Bearer " + key("anysearch"));
      const limited = structuredClone(cfg);
      limited.includeDomains = ["tavily.example"];
      const result = await searchWeb("restricted hosts", limited);
      assert.equal(result.hits.length, 1);
      assert.equal(new URL(result.hits[0].url).hostname, "tavily.example");
      await request(createApp())
        .post("/api/search/tools")
        .send({ tool: "search_stats" })
        .expect(401);
      const show = await admin
        .post("/api/search/tools")
        .send({ tool: "search_layer", input: { layer: "show" } })
        .expect(200);
      assert.equal(show.body.enginePool, "api");
      await admin
        .post("/api/search/tools")
        .send({ tool: "search_layer", input: { layer: "free" } })
        .expect(200);
      assert.equal(searchConfig().enginePool, "free");
      assert.equal((await save(publicSearchConfig(cfg))).status, 200);
    },
  );
  await t.test(
    "rotated keys preserve immutable job snapshots concurrently",
    async () => {
      const old = searchConfig(),
        config: any = publicSearchConfig(old);
      config.apiProviders.tavily.apiKey = "rotated-tavily-key";
      (await (await save(config)).status) === 200;
      const current = searchConfig();
      assert.notEqual(
        current.apiProviders.tavily.credentialId,
        old.apiProviders.tavily.credentialId,
      );
      const from = calls.length;
      await Promise.all([
        searchWeb("snapshot-old", old),
        searchWeb("snapshot-new", current),
      ]);
      const used = calls
        .slice(from)
        .filter((c) => c.name === "tavily")
        .map((c) => c.body.api_key);
      assert(used.includes(key("tavily")));
      assert(used.includes("rotated-tavily-key"));
    },
  );
  await t.test(
    "native tools validate inputs, block private pages and support cancellation",
    async () => {
      const cfg = searchConfig(),
        stats = await searchTool("search_stats", {}, cfg);
      assert.equal(stats.version, "0.2.4-beta.2");
      assert(!JSON.stringify(stats).includes("rotated-tavily-key"));
      await assert.rejects(
        searchTool("fetch_page", { url: "http://127.0.0.1/private" }, cfg),
      );
      await assert.rejects(
        searchTool("adaptive_search", { questions: ["training update?"] }, cfg),
        /Jev/,
      );
      await assert.rejects(searchTool("x_search", { type: "invalid" }, cfg));
      const disabled = structuredClone(cfg);
      disabled.tools.x_search = false;
      await assert.rejects(
        searchTool("x_search", { type: "keyword", query: "test" }, disabled),
        /关闭/,
      );
      const controller = new AbortController();
      const pending = searchWeb("cancel-flight", cfg, controller.signal);
      setTimeout(() => controller.abort(), 100);
      await assert.rejects(pending, /取消/);
      await admin
        .post("/api/search/tools")
        .send({ tool: "clear_cache", input: {} })
        .expect(200);
      assert.equal((await searchWeb("after-cancel", cfg)).hits.length, 4);
    },
  );
  await t.test(
    "Jev uses its typed API and reports failure without leaking credentials",
    async () => {
      const config: any = publicSearchConfig(searchConfig());
      Object.assign(config.jev, {
        enabled: true,
        apiKey: key("jev"),
        baseUrl: origin + "/gateway/jev",
        timeoutSeconds: 30,
      });
      (await (await save(config)).status) === 200;
      const from = calls.length;
      const result = await searchTool(
        "adaptive_search",
        {
          questions: ["Confirmed football injury updates?"],
          keywords: ["injuries"],
          page_size: 10,
        },
        searchConfig(),
      );
      const call = calls.slice(from).find((c) => c.name === "jev");
      assert(call);
      assert.equal(call.headers.authorization, "Bearer " + key("jev"));
      assert.equal(call.body.model, "jev-latest");
      assert(!JSON.stringify(result).includes(key("jev")));
      assert.equal(result.results.length, 0);
      assert.equal(result.retrievalSufficient, false);
      assert.equal(result.coverageComplete, false);
      assert(result.warnings.length > 0);
    },
  );
  await t.test(
    "search disconnects and 503 recover without repeating model work",
    async () => {
      const cfg = structuredClone(searchConfig());
      cfg.enginePool = "api";
      for (const name of SEARCH_API_NAMES)
        cfg.apiProviders[name].enabled = name === "tavily";
      for (const query of ["network-recover", "network-503"]) {
        const result = await searchWeb(query, cfg);
        assert.equal(result.hits.length, 1, JSON.stringify(result));
        assert.equal(result.diagnostics.recovery.attempts, 2);
        assert.equal(result.diagnostics.recovery.recovered, true);
        assert.equal(result.diagnostics.engineStats.tavily.attempts, 2);
        assert.equal(calls.filter((c) => c.body.query === query).length, 2);
        if (query === "network-recover") {
          assert(
            result.diagnostics.recovery.networkErrors[0].codes.includes(
              "UND_ERR_SOCKET",
            ),
          );
          assert(!JSON.stringify(result).includes("rotated-tavily-key"));
        }
      }
      const failed = await searchWeb("network-exhaust", cfg);
      assert.equal(failed.hits.length, 0);
      assert.equal(failed.diagnostics.recovery.attempts, 3);
      assert.equal(
        calls.filter((c) => c.body.query === "network-exhaust").length,
        3,
      );
      assert.match(
        failed.diagnostics.engineStats.tavily.note,
        /UND_ERR_SOCKET/,
      );
      for (const query of ["network-auth", "network-empty"]) {
        const result = await searchWeb(query, cfg);
        assert.equal(result.hits.length, 0);
        assert.equal(result.diagnostics.recovery.attempts, 1);
        assert.equal(calls.filter((c) => c.body.query === query).length, 1);
      }
      const signal = AbortSignal.timeout(300);
      await assert.rejects(searchWeb("network-cancel", cfg, signal), /取消/);
      await new Promise((r) => setTimeout(r, 1100));
      assert.equal(
        calls.filter((c) => c.body.query === "network-cancel").length,
        1,
      );
    },
  );
  await t.test(
    "retry only transient engines and retain working partial results",
    async () => {
      const cfg = structuredClone(searchConfig());
      cfg.enginePool = "api";
      for (const name of SEARCH_API_NAMES)
        cfg.apiProviders[name].enabled = ["tavily", "brave"].includes(name);
      cfg.engineWeights = { tavily: 1, brave: 1 };
      const result = await searchWeb("network-mixed", cfg);
      assert.equal(result.hits.length, 1, JSON.stringify(result));
      assert.equal(result.diagnostics.engineStats.tavily.attempts, 2);
      assert.equal(result.diagnostics.engineStats.brave.attempts, 1);
      assert.deepEqual(
        new Set(result.diagnostics.enginesUsed),
        new Set(["tavily", "brave"]),
      );
      const partial = await searchWeb("network-partial", cfg);
      assert.equal(partial.hits.length, 1);
      assert.equal(partial.diagnostics.recovery.attempts, 1);
      assert.equal(
        calls.filter((c) => c.body.query === "network-partial").length,
        1,
      );
    },
  );
  await t.test(
    "network causes retain safe codes without retrying TLS, auth or challenges",
    () => {
      const error = (code: string) =>
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("secret must not be copied"), {
            code,
          }),
        });
      assert.equal(searchFailure(error("EAI_AGAIN")).retryable, true);
      assert.equal(searchFailure(error("CERT_HAS_EXPIRED")).retryable, false);
      assert.equal(searchFailure(error("ENOTFOUND")).retryable, false);
      for (const message of [
        "ddg: HTTP 202 (bot challenge)",
        "HTTP 401",
        "HTTP 403",
        "HTTP 429",
      ])
        assert.equal(searchFailure(new Error(message)).retryable, false);
      assert.equal(searchFailure(new Error("yahoo http 500")).retryable, true);
      assert(
        !JSON.stringify(searchFailure(error("ECONNRESET"))).includes("secret"),
      );
    },
  );
  await t.test(
    "API-only mode never falls back to free search and URL credentials are rejected",
    async () => {
      const config: any = publicSearchConfig(searchConfig());
      for (const name of SEARCH_API_NAMES)
        config.apiProviders[name].removeKey = true;
      config.jev.enabled = false;
      config.jev.removeKey = true;
      (await (await save(config)).status) === 200;
      const from = calls.length;
      let result: any;
      try {
        result = await searchWeb("without-api-key", searchConfig());
      } catch (error) {
        assert.match((error as Error).message, /API|api|引擎|可用/);
      }
      assert.equal(calls.length, from);
      if (result) assert.equal(result.hits.length, 0);
      assert.equal(
        publicSearchConfig(searchConfig()).apiProviders.tavily.hasKey,
        false,
      );
      for (const baseUrl of [
        "https://user:pass@search.example",
        "https://search.example/?key=unsafe",
      ]) {
        const bad: any = publicSearchConfig(searchConfig());
        bad.apiProviders.tavily.baseUrl = baseUrl;
        assert.equal((await save(bad)).status, 400);
      }
    },
  );
});
