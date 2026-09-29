import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { SearchConfig, SearchSchema, SEARCH_API_NAMES } from "./domain.js";
import { searchSecrets } from "./search-config.js";
type Pending = {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
};
type Runtime = {
  worker: Worker;
  home: string;
  pending: Map<string, Pending>;
  lastUsed: number;
};
const runtimes = new Map<string, Runtime>();
function dispose(key: string, r: Runtime) {
  runtimes.delete(key);
  for (const p of r.pending.values()) {
    p.cleanup();
    p.reject(new Error("搜索运行时已关闭"));
  }
  r.pending.clear();
  void r.worker
    .terminate()
    .finally(() => rmSync(r.home, { recursive: true, force: true }));
}
export function closeSearchRuntimes() {
  for (const [key, r] of runtimes) dispose(key, r);
}
const sweep = setInterval(() => {
  for (const [key, r] of runtimes)
    if (!r.pending.size && Date.now() - r.lastUsed > 30 * 60000)
      dispose(key, r);
}, 60000);
sweep.unref();
function runtime(cfg: SearchConfig) {
  const key = createHash("sha256").update(JSON.stringify(cfg)).digest("hex");
  const old = runtimes.get(key);
  if (old) return old;
  if (runtimes.size >= 8) {
    const idle = [...runtimes]
      .filter(([, r]) => !r.pending.size)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (idle) dispose(...idle);
    else throw new Error("搜索运行时繁忙，请稍后再试");
  }
  const home = mkdtempSync(join(tmpdir(), "touchline-search-")),
    secrets = searchSecrets(cfg);
  const env: Record<string, string> = {
    PATH: process.env.PATH || "",
    HOME: home,
    SEARCH_BOOST_HOME: home,
    SEARCH_BOOST_KEYS_FILE: join(home, "config/keys.json"),
    XAI_API_KEY: secrets.x || "",
  };
  for (const k of [
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
  ])
    if (process.env[k]) env[k] = process.env[k]!;
  const worker = new Worker(new URL("./search-worker.mjs", import.meta.url), {
    workerData: { cfg, secrets, home },
    env,
    execArgv: [],
  });
  const r: Runtime = { worker, home, pending: new Map(), lastUsed: Date.now() };
  runtimes.set(key, r);
  worker.unref();
  worker.on("message", ({ id, result, error }) => {
    const p = r.pending.get(id);
    if (!p) return;
    r.pending.delete(id);
    p.cleanup();
    r.lastUsed = Date.now();
    error ? p.reject(new Error(error)) : p.resolve(result);
    if (!r.pending.size) worker.unref();
  });
  worker.on("error", () => dispose(key, r));
  worker.on("exit", () => {
    if (runtimes.get(key) === r) dispose(key, r);
  });
  return r;
}
export function fusedDefaults(cfg: SearchConfig) {
  return {
    engine_pool: cfg.enginePool,
    engines:
      cfg.enginePool === "free"
        ? cfg.engines
        : cfg.enginePool === "api"
          ? SEARCH_API_NAMES.filter((n) => cfg.apiProviders[n].enabled)
          : [
              ...new Set([
                ...cfg.engines,
                ...SEARCH_API_NAMES.filter((n) => cfg.apiProviders[n].enabled),
              ]),
            ],
  };
}
export async function searchTool(
  tool: string,
  input: Record<string, unknown>,
  config: SearchConfig,
  signal?: AbortSignal,
): Promise<any> {
  const cfg = SearchSchema.parse(config);
  if (signal?.aborted) throw signal.reason;
  if (tool in cfg.tools && !cfg.tools[tool as keyof typeof cfg.tools])
    throw new Error("此搜索工具已在后台关闭");
  const r = runtime(cfg),
    id = randomUUID();
  r.lastUsed = Date.now();
  r.worker.ref();
  return new Promise((resolve, reject) => {
    const abort = () => {
      r.worker.postMessage({ id, cancel: true });
      const p = r.pending.get(id);
      if (p) {
        r.pending.delete(id);
        p.cleanup();
        reject(new Error(signal?.aborted ? "搜索已取消" : "搜索超过设定时限"));
      }
      if (!r.pending.size) r.worker.unref();
    };
    const duration =
      tool === "adaptive_search"
        ? cfg.jev.timeoutSeconds + 10
        : cfg.timeoutSeconds;
    const timer = setTimeout(abort, duration * 1000);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    r.pending.set(id, { resolve, reject, cleanup });
    signal?.addEventListener("abort", abort, { once: true });
    r.worker.postMessage({ id, tool, input });
  });
}
