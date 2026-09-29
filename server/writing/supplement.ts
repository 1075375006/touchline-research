import { z } from "zod";
import { uid } from "../db.js";
import { now, errorMessage, type Source } from "../domain.js";
import { searchWeb, readSource } from "../search.js";

export const SearchRequestSchema = z.object({
  query: z.string().trim().min(3).max(240),
  intent: z.string().trim().min(1).max(500),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type WritingSearchTools = {
  search: typeof searchWeb;
  read: typeof readSource;
};
type Call = <T>(
  label: string,
  prompt: string,
  schema: z.ZodType<T>,
) => Promise<T>;
const normalize = (s: string) => s.replace(/\s+/gu, " ").trim().toLowerCase();
const urlKey = (url: string) => {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
};
const ClaimSchema = z.object({
  claim: z.string().trim().min(1).max(1000),
  quote: z.string().trim().min(12).max(1600),
  eventDate: z.string().nullable(),
  effect: z.enum(["supports", "opposes", "neutral", "unknown"]),
  directionReason: z.string().max(800),
  limitation: z.string().max(800),
});

// The entire checkpoint belongs to the writing run. Original research tables are never written.
export function writingSupplement(options: {
  input: any;
  progress: any;
  signal: AbortSignal;
  check: () => void;
  save: () => void;
  event: (type: string, message: string, data?: unknown) => void;
  call: Call;
  tools?: WritingSearchTools;
}) {
  const { input, progress, signal, check, save, event, call } = options;
  const tools = options.tools || { search: searchWeb, read: readSource };
  const enabled = input.supplementSearch === true && !!input.searchConfig;
  const state = (progress.supplement ||= {
    queries: [],
    pages: [],
    evidence: [],
    checkpoints: {},
    warnings: [],
  });
  const pool = (): any[] => [...input.evidence, ...state.evidence];
  const remaining = () =>
    Math.max(0, input.maxSupplementQueries - state.queries.length);
  function warn(message: string) {
    const text = message.slice(0, 1200);
    if (!state.warnings.includes(text)) {
      state.warnings.push(text);
      event("search_warning", text);
      save();
    }
  }
  function digest() {
    return JSON.stringify({
      fixture: input.fixture,
      direction: input.direction,
      researchCutoff: input.cutoff,
      supplementCutoff: input.supplementCutoff,
      evidence: pool().map((e) => ({
        id: e.id,
        claim: e.claim,
        quote: e.quote,
        limitation: e.limitation,
      })),
      previousQueries: state.queries.map((q: any) => ({
        query: q.query,
        status: q.status,
      })),
      limitations: state.warnings,
    });
  }
  async function processPage(page: any, request: SearchRequest) {
    check();
    if (!page.source) {
      if ((page.readAttempts || 0) >= 2) {
        page.done = true;
        warn("网页读取中断次数达到上限：" + page.hit.url);
        return;
      }
      page.readAttempts = (page.readAttempts || 0) + 1;
      save();
      try {
        page.source = await tools.read(
          page.hit,
          input.searchConfig,
          input.supplementCutoff,
          signal,
        );
      } catch (error) {
        check();
        page.done = true;
        warn("补搜网页读取失败：" + errorMessage(error));
        return;
      }
      check();
      save();
    }
    const source: Source = page.source;
    if (
      source.status !== "read" ||
      !source.text ||
      !source.domain ||
      (source.published &&
        (!Number.isFinite(Date.parse(source.published)) ||
          Date.parse(source.published) > Date.parse(input.supplementCutoff)))
    ) {
      page.done = true;
      warn(
        "补搜来源未作为证据：" +
          source.title +
          "（" +
          source.status +
          (source.error ? "；" + source.error : "") +
          "）",
      );
      return;
    }
    if (!page.extracted) {
      page.extracted = await call(
        "提取补搜网页的可核验事实",
        "补搜提取：从下面这一篇网页提取最多4条与本场比赛及用户方向相关的事实；不相关则返回空数组。quote逐字摘录原文，不能翻译或拼接成不存在的句子。claim可用中文解释。eventDate填写事实发生日期，无法确定填null；不要把网页抓取时间当发布日期。区分成年队、青年队、性别和赛事。支持、反对和未知均如实保留。" +
          JSON.stringify({
            fixture: input.fixture,
            direction: input.direction,
            intent: request.intent,
            cutoff: input.supplementCutoff,
            source,
          }),
        z.object({ claims: z.array(ClaimSchema).max(4) }),
      );
      save();
    }
    if (!page.candidates) {
      page.candidates = page.extracted.claims.filter((c: any) => {
        const validDate =
          !c.eventDate ||
          (Number.isFinite(Date.parse(c.eventDate)) &&
            Date.parse(c.eventDate) <= Date.parse(input.supplementCutoff));
        return validDate && normalize(source.text).includes(normalize(c.quote));
      });
      if (page.candidates.length < page.extracted.claims.length)
        warn("已剔除无法匹配原文或超出时间边界的补搜主张：" + source.title);
      save();
    }
    if (page.candidates.length && !page.audit) {
      const n = page.candidates.length;
      page.audit = await call(
        "独立核验补搜事实与原文",
        "补搜核验：独立审核每条候选claim是否被quote及其网页上下文直接支持，球队/年龄/赛事/日期是否一致、与本场是否相关，effect和directionReason是否夸大。仅字面包含并不代表语义支持。无法证实或对象混淆时supported=false。不能用模型记忆补足。每个index恰好返回一次。" +
          JSON.stringify({
            fixture: input.fixture,
            direction: input.direction,
            cutoff: input.supplementCutoff,
            source,
            candidates: page.candidates.map((c: any, index: number) => ({
              index,
              ...c,
            })),
          }),
        z.object({
          decisions: z
            .array(
              z.object({
                index: z
                  .number()
                  .int()
                  .min(0)
                  .max(n - 1),
                supported: z.boolean(),
                reason: z.string().min(1).max(700),
              }),
            )
            .length(n)
            .refine(
              (a) => new Set(a.map((d) => d.index)).size === n,
              "每条候选必须且只能核验一次",
            ),
        }),
      );
      save();
    }
    for (const decision of page.audit?.decisions || []) {
      if (!decision.supported) {
        warn("补搜主张未通过语义核验：" + decision.reason);
        continue;
      }
      const c = page.candidates[decision.index];
      if (
        state.evidence.some(
          (e: any) =>
            e.sourceId === source.id &&
            e.quote === c.quote &&
            e.claim === c.claim,
        )
      )
        continue;
      state.evidence.push({
        ...c,
        id: "w-" + uid(),
        sourceId: source.id,
        origin: "writing",
        kind: "fact",
        confidence: source.published ? "medium" : "low",
        limitation: [
          c.limitation,
          !source.published ? "网页发布日期不明，赛前时效需要人工复核" : "",
        ]
          .filter(Boolean)
          .join("；"),
        auditReason: decision.reason,
      });
    }
    page.done = true;
    save();
    event("source", "已核验补搜来源：" + source.title, {
      url: source.url,
      status: source.status,
      published: source.published,
      evidenceCount: state.evidence.filter((e: any) => e.sourceId === source.id)
        .length,
    });
  }
  async function execute(key: string, requests: SearchRequest[]) {
    if (!enabled) return;
    for (let index = 0; index < requests.length; index++) {
      check();
      const request = SearchRequestSchema.parse(requests[index]);
      const queryId = key + ":" + index;
      let record = state.queries.find((q: any) => q.id === queryId);
      if (!record) {
        if (
          state.queries.some(
            (q: any) => normalize(q.query) === normalize(request.query),
          )
        ) {
          warn("重复补搜查询已跳过：" + request.query);
          continue;
        }
        if (remaining() <= 0) {
          warn("补搜查询预算已用尽；未核实的内容不得写成事实。");
          break;
        }
        record = {
          id: queryId,
          ...request,
          status: "searching",
          startedAt: now(),
          pageIds: [],
        };
        state.queries.push(record);
        save();
        event("search", "补搜：" + request.query, {
          intent: request.intent,
          used: state.queries.length,
          limit: input.maxSupplementQueries,
        });
        try {
          const result = await tools.search(
            request.query,
            input.searchConfig,
            signal,
            request.intent,
          );
          check();
          record.warnings = result.warnings;
          record.hitCount = result.hits.length;
          record.status = "reading";
          const seen = new Set(state.pages.map((p: any) => urlKey(p.hit.url)));
          const hits = result.hits
            .filter((h) => {
              const key = urlKey(h.url);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, input.pagesPerQuery);
          for (const hit of hits) {
            const page = { id: uid(), hit, done: false };
            state.pages.push(page);
            record.pageIds.push(page.id);
          }
          save();
          for (const warning of result.warnings) warn("补搜限制：" + warning);
          if (!result.hits.length)
            warn("该查询未获得可读取的结果：" + request.query);
        } catch (error) {
          check();
          record.status = "failed";
          record.error = errorMessage(error);
          warn("补搜请求失败：" + record.error);
          save();
          continue;
        }
      } else if (record.status === "searching") {
        // A request was dispatched before shutdown. Do not silently spend its budget twice.
        record.status = "interrupted";
        warn("上次补搜请求中断，未自动重复计费：" + request.query);
      }
      if (record.status === "reading") {
        for (const pageId of record.pageIds) {
          const page = state.pages.find((p: any) => p.id === pageId);
          if (!page.done) await processPage(page, request);
        }
        record.status = "done";
        const sourceIds = new Set(
          state.pages
            .filter((p: any) => record.pageIds.includes(p.id))
            .map((p: any) => p.source?.id),
        );
        record.evidenceCount = state.evidence.filter((e: any) =>
          sourceIds.has(e.sourceId),
        ).length;
        if (!record.evidenceCount)
          warn(
            "该查询未取得可用的补充证据，相关缺口仍需复核：" + request.query,
          );
        save();
      }
    }
  }
  async function assess(key: string, goal: string) {
    if (!enabled) return;
    check();
    let step = state.checkpoints[key];
    if (!step) {
      const plan = await call(
        "主动检查写作资料缺口",
        "写作补搜计划：先审查现有证据是否足够支撑下面写作任务。主动寻找有利于用户方向的具体证据及独立佐证，优先当地语言、官方公告和原始数据，并核实反例与时效。已有充分证据则needsSearch=false。不要为写作常识或风格盲目搜。缺口尚未解决但预算为0时仍如实写needsSearch=true，queries为空。只返回简短决策说明reason、具体缺口gaps、最多2条不同查询及每条目的。" +
          JSON.stringify({
            goal,
            remainingQueries: remaining(),
            material: digest(),
          }),
        z
          .object({
            needsSearch: z.boolean(),
            reason: z.string().min(1).max(1000),
            gaps: z.array(z.string().min(1).max(500)).max(6),
            queries: z.array(SearchRequestSchema).max(2),
          })
          .refine(
            (p) => p.needsSearch || p.queries.length === 0,
            "不需要补搜时queries必须为空",
          )
          .refine(
            (p) => !p.needsSearch || remaining() === 0 || p.queries.length > 0,
            "仍有预算且需要补搜时必须提出查询",
          ),
      );
      step = state.checkpoints[key] = { plan, done: false };
      save();
      event("gap", plan.reason, {
        key,
        gaps: plan.gaps,
        needsSearch: plan.needsSearch,
      });
    }
    if (!step.done) {
      if (step.plan.needsSearch && !step.plan.queries.length)
        warn("仍有写作资料缺口：" + step.plan.gaps.join("；"));
      await execute(key, step.plan.queries);
      step.done = true;
      save();
    }
  }
  return { enabled, pool, state, remaining, assess, execute, digest };
}
