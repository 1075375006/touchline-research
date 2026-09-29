import { parentPort, workerData } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runFusedResilient } from "./search-resilience.mjs";
const { cfg, secrets, home } = workerData;
mkdirSync(home + "/config", { recursive: true, mode: 0o700 });
const engines = Object.fromEntries(
  Object.entries(cfg.apiProviders).map(([name, p]) => [
    name,
    { enabled: p.enabled, baseUrl: p.baseUrl },
  ]),
);
const keys = {
  ...Object.fromEntries(
    ["tavily", "brave", "exa", "anysearch"].map((name) => [
      name,
      secrets[name] || "",
    ]),
  ),
  engines,
  enabledEngines: Object.keys(engines).filter((name) => engines[name].enabled),
  ...(cfg.jev.enabled && secrets.jev
    ? { jev: { baseUrl: cfg.jev.baseUrl, apiKey: secrets.jev } }
    : {}),
};
writeFileSync(home + "/config/keys.json", JSON.stringify(keys), {
  mode: 0o600,
});
writeFileSync(
  home + "/config/layer.json",
  JSON.stringify({ layer: cfg.enginePool === "free" ? "free" : "api" }),
  { mode: 0o600 },
);
const native = await import("search-boost/lib/runtime.mjs");
const schemas = await import("search-boost/adapters/mcp/schemas.mjs");
const localRequire = createRequire(import.meta.url);
const { z } = createRequire(localRequire.resolve("search-boost/package.json"))(
  "zod",
);
const controllers = new Map();
function parse(name, input) {
  return z.object(schemas[name]).strict().parse(input);
}
function redact(value) {
  let text = JSON.stringify(value ?? null);
  for (const secret of Object.values(secrets))
    if (secret)
      text = text
        .split(JSON.stringify(secret).slice(1, -1))
        .join("[REDACTED]")
        .split(secret)
        .join("[REDACTED]");
  return JSON.parse(text);
}
parentPort.on("message", async ({ id, tool, input = {}, cancel }) => {
  if (cancel) {
    controllers.get(id)?.abort(new Error("已取消搜索"));
    return;
  }
  const controller = new AbortController();
  controllers.set(id, controller);
  const signal = controller.signal;
  try {
    if (tool in cfg.tools && !cfg.tools[tool])
      throw new Error("此搜索工具已在后台关闭");
    let result;
    if (tool === "fused_search") {
      const a = parse("fusedSearchInput", input);
      const pool =
        a.engine_pool ??
        (a.layer ? (a.layer === "api" ? "hybrid" : "free") : cfg.enginePool);
      const apiEngines = Object.keys(cfg.apiProviders).filter(
        (name) => cfg.apiProviders[name].enabled,
      );
      const savedEngines =
        cfg.enginePool === "free"
          ? cfg.engines
          : cfg.enginePool === "api"
            ? apiEngines
            : [...new Set([...cfg.engines, ...apiEngines])];
      result = await runFusedResilient(native, {
        query: a.query,
        queries: a.queries,
        engineList:
          a.engines ?? (a.engine_pool || a.layer ? undefined : savedEngines),
        enginePool: pool,
        layer: a.layer,
        maxResults: a.max_results ?? cfg.maxResults,
        maxResultsCap: 20,
        includeDomains: a.include_domains ?? cfg.includeDomains,
        excludeDomains: a.exclude_domains ?? cfg.excludeDomains,
        recency: a.recency ?? (cfg.recency || undefined),
        ranking: a.ranking ?? cfg.ranking,
        complexity: a.complexity ?? cfg.complexity,
        engineWeights: a.engine_weights ?? cfg.engineWeights,
        minScore: a.min_score ?? cfg.minScore,
        community: a.community ?? cfg.community,
        depth: cfg.depth || undefined,
        signal,
      });
    } else if (tool === "fetch_page") {
      const a = parse("fetchPageInput", input);
      result = await native.runFetchPage(a.url, a.focus, signal);
    } else if (tool === "x_search") {
      const a = parse("xSearchInput", input);
      result = await native.runXSearch(
        { ...a, enginePool: cfg.enginePool },
        { signal },
      );
    } else if (tool === "adaptive_search") {
      if (!cfg.jev.enabled || !secrets.jev)
        throw new Error("请先启用 Jev 并保存 API Key");
      const a = parse("adaptiveSearchInput", input);
      result = await native.runAdaptiveSearch(a, {
        signal,
        deadlineMs: cfg.jev.timeoutSeconds * 1000,
      });
    } else if (tool === "search_stats") {
      result = {
        version: "0.2.4-beta.2",
        stats: native.collectSearchStats(),
        capabilities: native.collectRuntimeCapabilities(),
        cache: native.cacheSizes(),
        toolSwitches: cfg.tools,
      };
    } else if (tool === "clear_cache") {
      native.clearAllCaches();
      result = { ok: true, cache: native.cacheSizes() };
    } else throw new Error("未知 SearchBoost 工具");
    parentPort.postMessage({ id, result: redact(result) });
  } catch (e) {
    parentPort.postMessage({
      id,
      error: redact(e instanceof Error ? e.message : String(e)),
    });
  } finally {
    controllers.delete(id);
  }
});
