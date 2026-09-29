import { articlePublication, publicationTime } from "./publication.js";
import * as cheerio from "cheerio";
import {
  SearchConfig,
  SearchSchema,
  Source,
  now,
  errorMessage,
} from "./domain.js";
import { searchTool, fusedDefaults } from "./search-runtime.js";
import { canonicalUrl, requestText } from "./network.js";
import { uid } from "./db.js";
export type Hit = {
  url: string;
  title: string;
  snippet: string;
  published: string | null;
  engine: string;
};
export async function searchWeb(
  query: string,
  cfg: SearchConfig,
  signal?: AbortSignal,
  intent?: string,
): Promise<{ hits: Hit[]; warnings: string[]; diagnostics?: any }> {
  cfg = SearchSchema.parse(cfg);
  const timeout = AbortSignal.any([
    AbortSignal.timeout(cfg.timeoutSeconds * 1000),
    ...(signal ? [signal] : []),
  ]);
  if (cfg.engine === "searxng") {
    const u = new URL("/search", cfg.searxngUrl);
    u.searchParams.set("q", query);
    u.searchParams.set("format", "json");
    u.searchParams.set("language", "auto");
    const r = JSON.parse(
      (await requestText(u.href, { trusted: true, signal: timeout })).text,
    );
    return {
      hits: (r.results || [])
        .map((h: any) => ({
          url: h.url,
          title: h.title,
          snippet: h.content || "",
          published: h.publishedDate || null,
          engine: (h.engines || ["searxng"]).join(","),
        }))
        .filter((h: Hit) => !excluded(h.url, cfg)),
      warnings: (r.unresponsive_engines || []).map((e: any) => String(e)),
    };
  }
  const adaptive = cfg.strategy === "adaptive";
  const r = await searchTool(
    adaptive ? "adaptive_search" : "fused_search",
    adaptive
      ? {
          questions: [query],
          intent: [cfg.jev.intent, intent]
            .filter(Boolean)
            .join("；")
            .slice(0, 2000),
          ...(cfg.jev.keywords.length ? { keywords: cfg.jev.keywords } : {}),
          constraints: cfg.jev.constraints,
          page_size: cfg.maxResults,
        }
      : { query, ...fusedDefaults(cfg) },
    cfg,
    signal,
  );
  return {
    hits: (r.results || [])
      .map((h: any) => ({
        url: h.url,
        title: h.title || "",
        snippet: h.snippet || h.description || "",
        published: h.published || null,
        engine: (h.engines || [adaptive ? "jev-adaptive" : "searchboost"]).join(
          ",",
        ),
      }))
      .filter((h: Hit) => !excluded(h.url, cfg)),
    warnings: [
      ...new Set([
        ...(r.warnings || []),
        ...Object.entries(r.engineStats || {})
          .filter(([, v]: any) => v.errors)
          .map(([k, v]: any) => k + ": " + (v.note || "搜索失败")),
      ]),
    ],
    diagnostics: {
      strategy: cfg.strategy,
      enginePool: r.enginePool,
      ranking: r.ranking,
      engineStats: r.engineStats,
      recovery: r.recovery,
      enginesUsed: r.enginesUsed,
      cacheHit: r.cacheHit,
      funnel: r.funnel,
      nextCursor: r.nextCursor,
      totalResults: r.totalResults,
      retrievalSufficient: r.retrievalSufficient,
      convergence: r.convergence,
      reviewSummary: r.reviewSummary,
      keywordProgress: r.keywordProgress,
      pendingAssessments: r.pendingAssessments,
      stopReason: r.stopReason,
    },
  };
}
function excluded(url: string, cfg: SearchConfig) {
  try {
    const h = new URL(url).hostname;
    const matches = (d: string) =>
      h === d.toLowerCase() || h.endsWith("." + d.toLowerCase());
    return (
      cfg.excludeDomains.some(matches) ||
      (cfg.includeDomains.length > 0 && !cfg.includeDomains.some(matches))
    );
  } catch {
    return true;
  }
}
export async function readSource(
  hit: Hit,
  cfg: SearchConfig,
  cutoff: string,
  signal?: AbortSignal,
): Promise<Source> {
  cfg = SearchSchema.parse(cfg);
  const url = canonicalUrl(hit.url),
    domain = new URL(url).hostname;
  const s: Source = {
    id: uid(),
    url,
    domain,
    title: hit.title,
    snippet: hit.snippet,
    text: "",
    published: publicationTime(hit.published, url).published,
    publishedBasis: "搜索索引；" + publicationTime(hit.published, url).basis,
    fetchedAt: now(),
    status: "snippet",
    engine: hit.engine,
    tier: cfg.trustedDomains.some(
      (d) => domain === d || domain.endsWith("." + d),
    )
      ? "official_or_trusted"
      : "unclassified",
  };
  try {
    if (cfg.reader === "searchboost") {
      const page = await searchTool("fetch_page", { url }, cfg, signal);
      s.text = String(page.content || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 22000);
      if (s.text.length < 120)
        throw new Error("SearchBoost 未返回足够的可读正文");
      s.status = s.published && s.published > cutoff ? "after_cutoff" : "read";
      s.reader = page.via;
      return s;
    }
    const res = await requestText(url, {
      signal,
      timeout: cfg.timeoutSeconds * 1000,
    });
    s.url = canonicalUrl(res.url);
    s.domain = new URL(s.url).hostname;
    s.tier = cfg.trustedDomains.some(
      (d) => s.domain === d || s.domain.endsWith("." + d),
    )
      ? "official_or_trusted"
      : "unclassified";
    if (!/text\/html|application\/xhtml|text\/plain/.test(res.contentType))
      throw new Error("当前正文读取器仅支持HTML或纯文本");
    const $ = cheerio.load(res.text);
    const date = articlePublication($, s.url);
    if (date.published) {
      s.published = date.published;
      s.publishedBasis = date.basis;
    } else if (!s.published) s.publishedBasis = date.basis;
    s.title = $("title").first().text().trim() || s.title;
    $("script,style,nav,header,footer,aside,noscript,form,svg").remove();
    const content = $("article").length
      ? $("article").text()
      : $("main").length
        ? $("main").text()
        : $("body").text();
    s.text = content.replace(/\s+/g, " ").trim().slice(0, 22000);
    if (s.text.length < 120) throw new Error("网页正文过短或需要浏览器/登录");
    if (
      /captcha|verify you are human|access denied|just a moment/i.test(s.title)
    )
      throw new Error("站点返回验证或拒绝页面");
    s.status = s.published && s.published > cutoff ? "after_cutoff" : "read";
  } catch (e) {
    if (signal?.aborted) throw e;
    s.status = "failed";
    s.error = errorMessage(e);
    s.text = "";
  }
  return s;
}
