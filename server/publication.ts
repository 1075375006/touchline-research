import type { CheerioAPI } from "cheerio";

export function publicationTime(
  raw: unknown,
  url: string,
): { published: string | null; basis: string } {
  if (typeof raw !== "string" || !raw.trim())
    return { published: null, basis: "unknown" };
  const value = raw.trim();
  const match = value.match(
    /^([0-9]{4})[-/年]([0-9]{1,2})[-/月]([0-9]{1,2})日?[T ]+([0-9]{1,2}):([0-9]{2})(?::([0-9]{2})([.][0-9]{1,3})?)? *(Z|[+-][0-9]{2}:?[0-9]{2}|北京时间|中国标准时间|UTC|GMT)?$/i,
  );
  if (!match)
    return {
      published: null,
      basis: "日期精度或时区不明确：" + value.slice(0, 100),
    };
  const [, y, m, d, h, min, sec = "00", fraction = "", explicit] = match;
  const day = new Date(Date.UTC(+y, +m - 1, +d));
  if (
    day.getUTCFullYear() !== +y ||
    day.getUTCMonth() !== +m - 1 ||
    day.getUTCDate() !== +d ||
    +h > 23 ||
    +min > 59 ||
    +sec > 59
  )
    return { published: null, basis: "发布时间无效" };
  const cctv = /(^|[.])cctv[.](com|cn)$/.test(new URL(url).hostname);
  const zone = explicit
    ? /北京时间|中国标准时间/.test(explicit)
      ? "+08:00"
      : /^(UTC|GMT)$/i.test(explicit)
        ? "Z"
        : explicit
    : cctv
      ? "+08:00"
      : "";
  if (!zone)
    return {
      published: null,
      basis: "原文有时间但未声明时区：" + value.slice(0, 100),
    };
  const iso =
    y +
    "-" +
    m.padStart(2, "0") +
    "-" +
    d.padStart(2, "0") +
    "T" +
    h.padStart(2, "0") +
    ":" +
    min +
    ":" +
    sec +
    fraction +
    zone;
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? {
        published: new Date(ms).toISOString(),
        basis: explicit
          ? "原文明确时区：" + value
          : "央视发布时间按北京时间 UTC+08:00：" + value,
      }
    : { published: null, basis: "发布时间无效" };
}

export function articlePublication($: CheerioAPI, url: string) {
  const candidates: Array<{ value: string; basis: string }> = [];
  const names = new Set([
    "article:published_time",
    "og:pubdate",
    "pubdate",
    "publishdate",
    "publish_time",
    "date",
    "datepublished",
    "datecreated",
  ]);
  $("meta").each((_, el) => {
    const node = $(el);
    const name = (
      node.attr("property") ||
      node.attr("name") ||
      node.attr("itemprop") ||
      ""
    ).toLowerCase();
    if (names.has(name) && node.attr("content"))
      candidates.push({ value: node.attr("content")!, basis: "meta:" + name });
  });
  $("script")
    .filter((_, el) => $(el).attr("type") === "application/ld+json")
    .each((_, el) => {
      if ($(el).text().length > 200000) return;
      try {
        const walk = (v: any, depth = 0) => {
          if (!v || depth > 5) return;
          if (Array.isArray(v)) {
            v.slice(0, 50).forEach((item) => walk(item, depth + 1));
            return;
          }
          if (typeof v !== "object") return;
          if (
            [v["@type"]]
              .flat()
              .some((type) =>
                /^(NewsArticle|Article|BlogPosting|ReportageNewsArticle|LiveBlogPosting)$/.test(
                  type,
                ),
              ) &&
            typeof v.datePublished === "string"
          )
            candidates.push({
              value: v.datePublished,
              basis: "JSON-LD datePublished",
            });
          if (v["@graph"]) walk(v["@graph"], depth + 1);
          if (v.mainEntity) walk(v.mainEntity, depth + 1);
        };
        walk(JSON.parse($(el).text()));
      } catch {
        /* Invalid metadata does not invalidate readable text. */
      }
    });
  $("time[itemprop=datePublished],time[pubdate],time.pubdate").each((_, el) => {
    const value = $(el).attr("datetime") || $(el).text().trim();
    if (value) candidates.push({ value, basis: "publication time element" });
  });
  if (/(^|[.])cctv[.](com|cn)$/.test(new URL(url).hostname)) {
    $(".info,.info1,.source,.publish_time,.pub-time").each((_, el) => {
      const text = $(el)
        .text()
        .split(String.fromCharCode(10))
        .join(" ")
        .slice(0, 600);
      const date = text.match(
        /[0-9]{4}[-/年][0-9]{1,2}[-/月][0-9]{1,2}日? +[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?/,
      );
      if (date)
        candidates.push({ value: date[0], basis: "央视文章发布时间栏" });
    });
  }
  for (const candidate of candidates) {
    const parsed = publicationTime(candidate.value, url);
    if (parsed.published)
      return {
        published: parsed.published,
        basis: candidate.basis + "；" + parsed.basis,
      };
  }
  return {
    published: null,
    basis: candidates.length
      ? publicationTime(candidates[0].value, url).basis
      : "unknown",
  };
}
