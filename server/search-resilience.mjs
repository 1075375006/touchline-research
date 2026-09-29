import { setTimeout as delay } from "node:timers/promises";

const TRANSIENT_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENETDOWN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

// Only controlled error codes leave the transport layer. Never copy request
// headers, response bodies, URLs with credentials, or raw socket objects.
export function searchFailure(error) {
  const codes = new Set();
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 5 || seen.has(value)) return;
    seen.add(value);
    if (
      typeof value.code === "string" &&
      /^[A-Z][A-Z0-9_]{1,64}$/.test(value.code)
    )
      codes.add(value.code);
    visit(value.cause, depth + 1);
    for (const item of Array.isArray(value.errors) ? value.errors : [])
      visit(item, depth + 1);
  };
  visit(error);
  const message = String(error?.message || "");
  const status = /\bHTTP\s+(\d{3})\b/i.exec(message)?.[1];
  const cancelled =
    /abort|cancel/i.test(error?.name || "") || error?.kind === "cancelled";
  const network =
    codes.size > 0 ||
    /fetch failed|network error|timed out|timeout/i.test(message);
  const retryable =
    !cancelled &&
    (status
      ? [408, 500, 502, 503, 504].includes(Number(status))
      : codes.size
        ? [...codes].every((code) => TRANSIENT_CODES.has(code))
        : network);
  return {
    codes: [...codes],
    status: status ? Number(status) : null,
    retryable,
    detail: network
      ? "网络请求失败（" + ([...codes].join(" / ") || "NETWORK_ERROR") + "）"
      : null,
  };
}

// SearchBoost intentionally does not cache a failed empty search. Retry only
// failed transient engines, only while the whole query has no usable results.
// Each round keeps the original caller's deadline and configuration snapshot.
export async function runFusedResilient(native, params, options = {}) {
  const started = Date.now();
  const state = native.resolveRuntimeEngines();
  const history = [];
  const aggregate = {};
  const networkErrors = [];
  const originalEngines = new Set();
  let first,
    result,
    selected = params.engineList;
  const wait =
    options.wait || ((ms, signal) => delay(ms, undefined, { signal }));
  for (let round = 1; round <= 3; round++) {
    params.signal?.throwIfAborted();
    const failures = new Map();
    const snapshot = {
      ...state,
      engines: Object.fromEntries(
        Object.entries(state.engines).map(([name, engine]) => [
          name,
          {
            ...engine,
            search: async (...args) => {
              try {
                return await engine.search(...args);
              } catch (error) {
                const failure = searchFailure(error);
                const previous = failures.get(name);
                failures.set(name, {
                  ...failure,
                  retryable: failure.retryable && previous?.retryable !== false,
                });
                if (failure.detail) {
                  networkErrors.push({
                    engine: name,
                    attempt: round,
                    codes: failure.codes,
                    retryable: failure.retryable,
                  });
                  throw new Error(name + ": " + failure.detail, {
                    cause: error,
                  });
                }
                throw error;
              }
            },
          },
        ]),
      ),
    };
    result = await native.runFused(
      {
        ...params,
        engineList: selected,
        ...(selected && params.engineWeights
          ? {
              engineWeights: Object.fromEntries(
                Object.entries(params.engineWeights).filter(([name]) =>
                  selected.includes(name),
                ),
              ),
            }
          : {}),
      },
      { snapshot: () => snapshot },
    );
    first ||= result;
    params.signal?.throwIfAborted();
    for (const [name, stat] of Object.entries(result.engineStats || {})) {
      originalEngines.add(name);
      const previous = aggregate[name] || {};
      aggregate[name] = {
        ...stat,
        used: Boolean(previous.used || stat.used),
        attempts: (previous.attempts || 0) + (stat.attempts || 0),
        errors: (previous.errors || 0) + (stat.errors || 0),
        successes: (previous.successes || 0) + (stat.successes || 0),
        ...(previous.errors && !stat.errors ? { note: "自动重试后恢复" } : {}),
      };
    }
    history.push({
      attempt: round,
      cacheHit: Boolean(result.cacheHit),
      engineStats: result.engineStats,
    });
    if (result.results?.length || round === 3) break;
    selected = [...failures]
      .filter(([, failure]) => failure.retryable)
      .map(([name]) => name);
    if (!selected.length) break;
    await wait(round === 1 ? 1000 : 2500, params.signal);
  }
  const recovered = history.length > 1 && Boolean(result.results?.length);
  const warnings = [
    ...new Set([
      ...(result.warnings || []),
      ...Object.entries(aggregate)
        .filter(([, stat]) => stat.errors && !stat.successes)
        .map(([name, stat]) => name + ": " + (stat.note || "搜索失败")),
      ...(history.length > 1
        ? [
            recovered
              ? "搜索网络异常，自动重试后已恢复（共 " +
                history.length +
                " 次尝试）"
              : "搜索已尝试 " +
                history.length +
                " 次，仍无可用结果；已保留检查点",
          ]
        : []),
    ]),
  ];
  return {
    ...result,
    warnings,
    engineStats: aggregate,
    enginesRequested: first.enginesRequested,
    enginesUsed: [...originalEngines],
    tookMs: Date.now() - started,
    recovery: { attempts: history.length, recovered, history, networkErrors },
  };
}
