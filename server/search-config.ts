import { z } from "zod";
import { SearchSchema, SEARCH_API_NAMES, SearchConfig, now } from "./domain.js";
import { db, seal, unseal, searchConfig, uid, transaction } from "./db.js";
const slots = [...SEARCH_API_NAMES, "jev", "x"] as const;
const block = (cfg: SearchConfig, name: (typeof slots)[number]) =>
  name === "jev" || name === "x" ? cfg[name] : cfg.apiProviders[name];
export function publicSearchConfig(cfg: SearchConfig) {
  const out: any = structuredClone(cfg);
  for (const name of slots) {
    const item = block(out, name) as any;
    item.hasKey = !!item.credentialId;
    delete item.credentialId;
  }
  return out;
}
export function prepareSearchConfig(raw: any): SearchConfig {
  const cfg = SearchSchema.parse(raw),
    old = searchConfig();
  return transaction(() => {
    for (const name of slots) {
      const patch =
        (name === "jev" || name === "x"
          ? raw[name]
          : raw.apiProviders?.[name]) || {};
      const input = z
        .object({
          apiKey: z.string().trim().max(4000).optional(),
          removeKey: z.boolean().optional(),
        })
        .parse(patch);
      const target = block(cfg, name);
      target.credentialId = block(old, name).credentialId;
      if (input.removeKey) target.credentialId = "";
      else if (input.apiKey) {
        target.credentialId = uid();
        db.prepare(
          "INSERT INTO search_credentials(id,kind,secret,created_at) VALUES(?,?,?,?)",
        ).run(target.credentialId, name, seal(input.apiKey), now());
      }
    }
    if (cfg.engine === "searchboost-api" && cfg.enginePool === "free")
      cfg.enginePool = "api";
    if (
      cfg.strategy === "adaptive" &&
      (!cfg.jev.enabled || !cfg.jev.credentialId || !cfg.tools.adaptive_search)
    )
      throw new Error(
        "自动研究使用 Jev 前，需要启用 Jev、填写密钥并开启 adaptive_search",
      );
    return cfg;
  });
}
export function searchSecrets(cfg: SearchConfig): Record<string, string> {
  return Object.fromEntries(
    slots.map((name) => {
      const id = block(cfg, name).credentialId;
      const row = id
        ? db
            .prepare(
              "SELECT secret FROM search_credentials WHERE id=? AND kind=?",
            )
            .get(id, name)
        : undefined;
      return [name, row ? unseal(String(row.secret)) : ""];
    }),
  );
}
