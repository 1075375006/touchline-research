import { z } from "zod";
import {
  writingSupplement,
  SearchRequestSchema,
  type WritingSearchTools,
} from "./supplement.js";
import { db } from "../db.js";
import { now, errorMessage } from "../domain.js";
import { completeJson, getProvider } from "../models.js";
import { WRITING_SYSTEM, countScriptChars } from "./domain.js";
import { writingRun, writingEvent } from "./repository.js";
const active = new Map<
  string,
  { controller: AbortController; promise: Promise<void> }
>();
let timer: ReturnType<typeof setInterval> | undefined;
let stopping = false;
export const writingIsActive = (id: string) => active.has(id);
export function cancelWriting(id: string) {
  const changed = db
    .prepare(
      "UPDATE writing_runs SET status=?,finished_at=? WHERE id=? AND status IN (?,?)",
    )
    .run("cancelled", now(), id, "queued", "running").changes;
  if (changed) {
    active.get(id)?.controller.abort();
    writingEvent(id, "cancelled", "已取消写作，保留已生成内容");
  }
}
export async function runWriting(
  id: string,
  signal: AbortSignal,
  ask = completeJson,
  searchTools?: WritingSearchTools,
) {
  const initial = writingRun(id);
  if (initial.status !== "queued") return;
  db.prepare(
    "UPDATE writing_runs SET status=?,started_at=COALESCE(started_at,?),error=NULL WHERE id=?",
  ).run("running", now(), id);
  const input = initial.input;
  const progress = initial.progress;
  const paragraphs: any[] = progress.paragraphs || [];
  const count = Math.ceil(input.target.target / 650);
  const maxCalls =
    count * 16 +
    24 +
    (input.supplementSearch
      ? input.maxSupplementQueries * input.pagesPerQuery * 6
      : 0);
  const deadline = Date.now() + 30 * 60 * 1000;
  const timeout = AbortSignal.timeout(30 * 60 * 1000);
  const combined = AbortSignal.any([signal, timeout]);
  function check() {
    if (combined.aborted || writingRun(id).status !== "running")
      throw new Error(
        timeout.aborted
          ? "写作超过 30 分钟，请缩短时长后新建版本"
          : "写作已停止",
      );
  }
  function save() {
    check();
    const content = paragraphs.map((p) => p.text).join("\n\n");
    db.prepare(
      "UPDATE writing_runs SET progress=?,content=?,character_count=? WHERE id=? AND status=?",
    ).run(
      JSON.stringify({ ...progress, paragraphs }),
      content,
      countScriptChars(content),
      id,
      "running",
    );
  }
  try {
    const provider = { ...getProvider(input.providerId), ...input.provider };
    const bindingSchema = (ids: string[]) =>
      z
        .array(z.enum(ids as [string, ...string[]]))
        .min(1)
        .max(12)
        .refine((a) => new Set(a).size === a.length, "证据ID不能重复");
    async function call<T>(
      label: string,
      prompt: string,
      schema: z.ZodType<T>,
    ): Promise<T> {
      check();
      writingEvent(id, "model", label);
      const value = await ask(
        provider,
        prompt,
        schema,
        combined,
        (tokens, thinking) => {
          db.prepare("UPDATE writing_runs SET tokens=tokens+? WHERE id=?").run(
            tokens,
            id,
          );
          if (thinking)
            writingEvent(
              id,
              "thinking",
              "模型请求的思考配置与返回状态",
              thinking,
            );
        },
        () => {
          check();
          if (Date.now() > deadline || writingRun(id).model_calls >= maxCalls)
            throw new Error("写作调用预算已用尽；已生成内容已保留");
          db.prepare(
            "UPDATE writing_runs SET model_calls=model_calls+1 WHERE id=?",
          ).run(id);
        },
        WRITING_SYSTEM,
      );
      check();
      return schema.parse(value);
    }
    const supplement = writingSupplement({
      input,
      progress,
      signal: combined,
      check,
      save,
      call,
      tools: searchTools,
      event: (type, message, data) => writingEvent(id, type, message, data),
    });
    await supplement.assess(
      "before-outline",
      "写前准备：判断核心观点、独立佐证、最新阵容与风险是否缺资料，先补足有价值的证据再规划口播。",
    );
    const context = JSON.stringify({
      fixture: input.fixture,
      direction: input.direction,
      cutoff: input.cutoff,
      supplementCutoff: input.supplementCutoff,
      researchStatus: input.researchStatus,
      report: input.report,
      style: input.style,
      knowledge: input.knowledge,
      instructions: input.instructions,
    });
    const evidence = JSON.stringify(supplement.pool());
    const bindings = bindingSchema(supplement.pool().map((e: any) => e.id));
    if (!progress.outline) {
      progress.outline = await call(
        "规划口播结构",
        "只规划口播，使用当前已核验的证据池。围绕用户方向选最强支持证据和独立佐证，同时保留研究报告的风险与条件。风格和知识库仅控制表达。目标约" +
          input.target.target +
          "个有效字（汉字、字母、数字，不含标点空格）。全稿分成恰好" +
          count +
          "段，每段约" +
          Math.round(input.target.target / count) +
          "字，分配不同论点避免重复。evidenceIds必须逐字复制下方证据对象的id（不是sourceId或报告中的简写），每段编号不重复。尾段含关键风险。材料：" +
          context +
          "\n证据：" +
          evidence,
        z.object({
          title: z.string().max(120),
          sections: z
            .array(
              z.object({
                heading: z.string().max(100),
                focus: z.string().max(1000),
                evidenceIds: bindings,
              }),
            )
            .length(count),
        }),
      );
      save();
    }
    for (let index = paragraphs.length; index < count; index++) {
      const section = progress.outline.sections[index];
      const target =
        Math.floor(input.target.target / count) +
        (index < input.target.target % count ? 1 : 0);
      await supplement.assess(
        "section-" + index,
        "准备第" +
          (index + 1) +
          "段：" +
          JSON.stringify(section) +
          "。结合提纲和已写正文检查有价值的新缺口。已写正文：" +
          paragraphs.map((p) => p.text).join(String.fromCharCode(10)),
      );
      const material = () =>
        JSON.stringify(
          supplement
            .pool()
            .filter(
              (e: any) =>
                section.evidenceIds.includes(e.id) || e.origin === "writing",
            ),
        );
      const prompt = () =>
        "写第" +
        (index + 1) +
        "/" +
        count +
        "段可直接朗读的中文口播。按指定JSON结构返回正文text、所用evidenceIds及允许的补搜请求；正文不要写标题、编号或引用标记。目标" +
        target +
        "个有效字，范围" +
        Math.ceil((target * 9) / 10) +
        "—" +
        Math.floor((target * 11) / 10) +
        "。不得将推断当事实，不引入未提供的本场事实或引语，不机械重复观点凑字。角色/研究材料：" +
        context +
        "\n完整提纲：" +
        JSON.stringify(progress.outline) +
        "\n本段：" +
        JSON.stringify(section) +
        "\n本段可用原文证据：" +
        material() +
        "\n已写正文：" +
        paragraphs.map((p) => p.text).join("\n");
      const availableIds = () =>
        supplement
          .pool()
          .filter(
            (e: any) =>
              section.evidenceIds.includes(e.id) || e.origin === "writing",
          )
          .map((e: any) => e.id);
      const localSchema = () =>
        z.object({
          text: z.string().trim().min(1).max(4000),
          evidenceIds: bindingSchema(availableIds()),
        });
      let paragraph: any;
      if (progress.pendingDraft?.index === index)
        paragraph = progress.pendingDraft.paragraph;
      else {
        const canSearch = supplement.enabled && supplement.remaining() > 0;
        paragraph = await call(
          "生成第 " + (index + 1) + " 段",
          prompt() +
            (canSearch
              ? " 写到需要新事实、数字、引语或独立佐证时，先在searchRequests中申请最多2条查询（query与intent），可先保留text为空、evidenceIds为空；不要硬写缺乏证据的句子。没有新缺口则searchRequests为空。剩余查询预算：" +
                supplement.remaining()
              : " 本轮不能继续搜索，删去无法核实的细节或明确说明未知。"),
          canSearch
            ? z
                .object({
                  text: z.string().max(4000),
                  evidenceIds: z
                    .array(z.enum(availableIds() as [string, ...string[]]))
                    .max(12)
                    .refine(
                      (a) => new Set(a).size === a.length,
                      "证据ID不能重复",
                    ),
                  searchRequests: z.array(SearchRequestSchema).max(2),
                })
                .refine(
                  (p) =>
                    p.searchRequests.length > 0 ||
                    (p.text.trim().length > 0 && p.evidenceIds.length > 0),
                  "正文或补搜请求至少提供一个",
                )
            : localSchema(),
        );
        if (paragraph.searchRequests?.length) {
          progress.pendingDraft = { index, paragraph };
          save();
        }
      }
      if (paragraph.searchRequests?.length) {
        await supplement.execute(
          "during-draft-" + index,
          paragraph.searchRequests,
        );
        paragraph = await call(
          "补搜后完成第 " + (index + 1) + " 段",
          prompt() +
            " 已按写作过程提出的请求补搜。根据当前核验材料完成本段，不再提出新查询；未证实的细节必须删除或明确未知。补搜结果摘要：" +
            supplement.digest(),
          localSchema(),
        );
      }
      const actual = countScriptChars(paragraph.text);
      if (actual < (target * 9) / 10 || actual > (target * 11) / 10)
        paragraph = await call(
          "校准第 " + (index + 1) + " 段字数",
          prompt() +
            "\n待调整正文：" +
            JSON.stringify(paragraph) +
            "\n实测" +
            actual +
            "字；请校准到约" +
            target +
            "字，保留事实边界和证据绑定，避免空洞重复。",
          localSchema(),
        );
      paragraphs.push({
        text: paragraph.text,
        evidenceIds: paragraph.evidenceIds,
      });
      delete progress.pendingDraft;
      save();
      writingEvent(
        id,
        "paragraph",
        "已保存第 " + (index + 1) + "/" + count + " 段",
        { characters: countScriptChars(paragraph.text), target },
      );
    }
    if (!progress.audit) {
      const decisions = z
        .array(
          z.object({
            index: z
              .number()
              .int()
              .min(0)
              .max(count - 1),
            supported: z.boolean(),
            reason: z.string().min(1).max(1500),
          }),
        )
        .length(count)
        .refine(
          (a) => new Set(a.map((x) => x.index)).size === count,
          "每段必须且只能审核一次",
        );
      progress.audit = await call(
        "逐段检查事实与证据",
        "审核以下口播的每个段落（index从0开始）。只判断该段引用的证据能否支撑其中全部事实、数字和引语，是否把推断写成事实，是否错误套用知识库示例中的事实。恰好返回每段一次。夸大或无依据时supported=false并指出具体问题。不要为了符合方向而放行。报告的判断边界：" +
          input.report +
          " 写作新增证据可以更新旧报告的判断，但必须说明条件和时效，不能沿用旧结论忽略新反例。" +
          "\n逐段正文及对应原文：" +
          JSON.stringify(
            paragraphs.map((p, index) => ({
              index,
              ...p,
              evidence: supplement
                .pool()
                .filter((e: any) => p.evidenceIds.includes(e.id)),
            })),
          ),
        z.object({ decisions }),
      );
      save();
    }
    const actual = countScriptChars(paragraphs.map((p) => p.text).join("\n"));
    const issues = progress.audit.decisions
      .filter((x: any) => !x.supported)
      .map((x: any) => "第" + (x.index + 1) + "段：" + x.reason);
    if (actual < input.target.min || actual > input.target.max)
      issues.push(
        "实际 " +
          actual +
          " 字，未达到目标区间 " +
          input.target.min +
          "—" +
          input.target.max +
          " 字；建议调整后重新生成。",
      );
    if (supplement.state.warnings.length)
      issues.push(
        "补搜存在限制或未通过核验的材料，请查看补搜记录；相关内容不得视为已证实。",
      );
    const usedIds = new Set(paragraphs.flatMap((p) => p.evidenceIds));
    if (
      supplement.state.evidence.some(
        (e: any) => usedIds.has(e.id) && e.confidence === "low",
      )
    )
      issues.push("稿件引用了发布日期不明的补搜网页，赛前时效需人工复核。");
    progress.issues = issues;
    save();
    const status = issues.length ? "needs_review" : "completed";
    db.prepare(
      "UPDATE writing_runs SET status=?,finished_at=? WHERE id=? AND status=?",
    ).run(status, now(), id, "running");
    writingEvent(
      id,
      status,
      issues.length
        ? "稿件已保存，存在待复核问题"
        : "稿件已生成，字数和模型证据审核通过；发布前请人工复核",
      { characters: actual, estimatedMinutes: actual / input.charsPerMinute },
    );
  } catch (e) {
    if (writingRun(id).status === "cancelled") return;
    if (signal.aborted) {
      db.prepare(
        "UPDATE writing_runs SET status=? WHERE id=? AND status=?",
      ).run("queued", id, "running");
      writingEvent(id, "checkpoint", "服务停止，已保存检查点；重启后继续写作");
    } else {
      const message = errorMessage(e);
      db.prepare(
        "UPDATE writing_runs SET status=?,error=?,finished_at=? WHERE id=? AND status=?",
      ).run("failed", message, now(), id, "running");
      writingEvent(id, "failed", message);
    }
  }
}
export function startWritingWorker() {
  if (timer) return;
  stopping = false;
  db.prepare("UPDATE writing_runs SET status=? WHERE status=?").run(
    "queued",
    "running",
  );
  const tick = () => {
    if (stopping || active.size) return;
    const row = db
      .prepare(
        "SELECT id FROM writing_runs WHERE status=? ORDER BY created_at LIMIT 1",
      )
      .get("queued");
    if (!row) return;
    const id = String(row.id),
      controller = new AbortController();
    const promise = runWriting(id, controller.signal).finally(() =>
      active.delete(id),
    );
    active.set(id, { controller, promise });
  };
  timer = setInterval(tick, 1000);
  timer.unref();
}
export async function stopWritingWorker() {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = undefined;
  for (const entry of active.values()) entry.controller.abort();
  await Promise.allSettled([...active.values()].map((x) => x.promise));
}
