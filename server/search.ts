import * as cheerio from "cheerio";
import { runFused } from "search-boost/lib/runtime.mjs";
import { SearchConfig, Source, now, errorMessage } from "./domain.js";
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
): Promise<{ hits: Hit[]; warnings: string[] }> {
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
  const r = await runFused({
    query,
    engineList: cfg.engines,
    enginePool: "free",
    layer: "free",
    maxResults: 8,
    maxResultsCap: 8,
    complexity: "simple",
    community: false,
    signal: timeout,
    excludeDomains: cfg.excludeDomains,
  });
  return {
    hits: (r.results || [])
      .map((h: any) => ({
        url: h.url,
        title: h.title || "",
        snippet: h.snippet || "",
        published: h.published || null,
        engine: (h.engines || []).join(","),
      }))
      .filter((h: Hit) => !excluded(h.url, cfg)),
    warnings: [
      ...(r.warnings || []),
      ...Object.entries(r.engineStats || {})
        .filter(([, v]: any) => v.errors)
        .map(([k, v]: any) => k + ": " + (v.note || "搜索失败")),
    ],
  };
}
function excluded(url: string, cfg: SearchConfig) {
  try {
    const h = new URL(url).hostname;
    return cfg.excludeDomains.some((d) => h === d || h.endsWith("." + d));
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
  const url = canonicalUrl(hit.url),
    domain = new URL(url).hostname;
  const s: Source = {
    id: uid(),
    url,
    domain,
    title: hit.title,
    snippet: hit.snippet,
    text: "",
    published:
      hit.published && Number.isFinite(Date.parse(hit.published))
        ? new Date(hit.published).toISOString()
        : null,
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
    const date =
      $('meta[property="article:published_time"]').attr("content") ||
      $('meta[name="date"]').attr("content") ||
      $("time[datetime]").first().attr("datetime");
    if (date && Number.isFinite(Date.parse(date)))
      s.published = new Date(date).toISOString();
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
