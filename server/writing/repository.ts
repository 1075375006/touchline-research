import { db, uid, transaction } from "../db.js";
import { searchConfig } from "../db.js";
import { thinkingValidation } from "../thinking.js";
import { publicSearchConfig } from "../search-config.js";
import { json, now } from "../domain.js";
import { getProvider } from "../models.js";
import { countScriptChars, lengthTarget, type WritingInput } from "./domain.js";
export function writingError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
export function initializeWriting() {
  db.exec(
    [
      "CREATE TABLE IF NOT EXISTS writing_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS writing_styles(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,instructions TEXT NOT NULL,chars_per_minute INTEGER NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS writing_knowledge(id TEXT PRIMARY KEY,style_id TEXT NOT NULL REFERENCES writing_styles(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS writing_runs(id TEXT PRIMARY KEY,job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,provider_id TEXT REFERENCES providers(id),style_id TEXT REFERENCES writing_styles(id) ON DELETE SET NULL,created_by TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,input TEXT NOT NULL,progress TEXT NOT NULL,content TEXT NOT NULL,character_count INTEGER NOT NULL DEFAULT 0,model_calls INTEGER NOT NULL DEFAULT 0,tokens INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT)",
      "CREATE TABLE IF NOT EXISTS writing_events(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES writing_runs(id) ON DELETE CASCADE,type TEXT NOT NULL,message TEXT NOT NULL,data TEXT,created_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS writing_runs_status ON writing_runs(status,created_at)",
      "CREATE INDEX IF NOT EXISTS writing_runs_job ON writing_runs(job_id)",
    ].join(";"),
  );
  transaction(() => {
    if (
      !db
        .prepare("SELECT key FROM writing_meta WHERE key=?")
        .get("styles_seeded")
    ) {
      const defaults = [
        [
          "evidence",
          "理性证据解说",
          "清晰、克制，用事实解释比赛方向。",
          "你是严谨而通俗的足球解说编辑。先给有条件的核心判断，再依次解释最有力的事实、独立佐证与场面机制。句子短，术语解释清楚；不堆砌数字，不渲染必胜。结尾说明适用条件与值得复核的消息。",
          240,
        ],
        [
          "story",
          "故事化解说",
          "围绕一个真实问题展开有起伏的分析。",
          "你是擅长叙事的足球口播编辑。从本场一个有证据的悬念切入，按球队选择、对手回应、场面代价推进。用自然转折形成叙事，所有场景和引语必须来自研究证据。没有素材时用问题引导，不虚构现场画面或人物心理。",
          220,
        ],
        [
          "brief",
          "快节奏短评",
          "先给重点，以紧凑节奏呈现支持理由与风险。",
          "你是短视频足球评论编辑。开头迅速点明方向与成立条件，选择少量最强证据逐层展开。使用短句、自然口语和清晰停顿，避免口号与重复铺垫；最后给出关键风险，不作确定性承诺。",
          270,
        ],
      ];
      for (const [id, name, description, instructions, rate] of defaults)
        db.prepare("INSERT INTO writing_styles VALUES(?,?,?,?,?,?,?,?)").run(
          "builtin-" + id,
          name,
          description,
          instructions,
          rate,
          1,
          now(),
          now(),
        );
      db.prepare("INSERT INTO writing_meta VALUES(?,?)").run(
        "styles_seeded",
        "1",
      );
    }
    if (
      !db
        .prepare("SELECT key FROM writing_meta WHERE key=?")
        .get("legacy_scripts")
    ) {
      for (const r of db
        .prepare(
          "SELECT reports.*,jobs.fixture,jobs.direction,jobs.created_by,jobs.provider_id,jobs.context,jobs.cutoff FROM reports JOIN jobs ON jobs.id=reports.job_id WHERE length(trim(reports.script))>0",
        )
        .all()) {
        const id = "legacy-" + r.job_id;
        const input = {
          legacy: true,
          fixture: json(r.fixture, {}),
          direction: r.direction,
          cutoff: r.cutoff,
          style: { name: "历史口播稿", instructions: "" },
          knowledge: [],
          target: null,
          durationMinutes: null,
          charsPerMinute: 240,
          report: r.markdown,
        };
        const progress = {
          paragraphs: json<any>(r.context, {}).scriptBindings || [],
          issues: ["由旧研究模块迁入，未按新字数和独立写作审核流程重新生成。"],
        };
        db.prepare(
          "INSERT OR IGNORE INTO writing_runs(id,job_id,provider_id,style_id,created_by,status,input,progress,content,character_count,created_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          r.job_id,
          r.provider_id,
          null,
          r.created_by,
          "needs_review",
          JSON.stringify(input),
          JSON.stringify(progress),
          r.script,
          countScriptChars(String(r.script)),
          r.created_at,
          r.created_at,
        );
      }
      db.prepare("INSERT INTO writing_meta VALUES(?,?)").run(
        "legacy_scripts",
        "1",
      );
    }
  });
}
export function styles(): any[] {
  return db
    .prepare("SELECT * FROM writing_styles ORDER BY created_at,id")
    .all()
    .map((r) => ({
      ...r,
      charsPerMinute: r.chars_per_minute,
      enabled: !!r.enabled,
      knowledge: db
        .prepare(
          "SELECT * FROM writing_knowledge WHERE style_id=? ORDER BY created_at,id",
        )
        .all(r.id)
        .map((k) => ({ ...k, enabled: !!k.enabled })),
    }));
}
export function writingRun(id: string): any {
  const r = db.prepare("SELECT * FROM writing_runs WHERE id=?").get(id);
  if (!r) writingError(404, "写作任务不存在");
  return {
    ...r,
    input: json<any>(r.input, {}),
    progress: json<any>(r.progress, {}),
  };
}
export function writingEvent(
  id: string,
  type: string,
  message: string,
  data?: unknown,
) {
  db.prepare(
    "INSERT INTO writing_events(run_id,type,message,data,created_at) VALUES(?,?,?,?,?)",
  ).run(id, type, message, data ? JSON.stringify(data) : null, now());
}
const normalize = (s: string) => s.replace(/[\s]+/g, " ").trim().toLowerCase();
export function createWriting(input: WritingInput, userId: string) {
  const job = db
    .prepare(
      "SELECT jobs.*,reports.markdown,reports.verdict,reports.created_at AS report_at FROM jobs JOIN reports ON reports.job_id=jobs.id WHERE jobs.id=?",
    )
    .get(input.jobId);
  if (!job) writingError(409, "请先完成资料研究并生成研究报告");
  if (["queued", "running"].includes(String(job.status)))
    writingError(409, "资料研究仍在运行，请结束或暂停后再启动写作");
  const style = styles().find((x) => x.id === input.styleId);
  if (!style || !style.enabled) writingError(400, "请选择启用的写作风格");
  const provider = getProvider(input.providerId);
  const sources = db
    .prepare("SELECT id,data FROM sources WHERE job_id=?")
    .all(input.jobId)
    .map((r) => ({ ...json<any>(r.data, {}), id: String(r.id) }));
  const evidence = db
    .prepare("SELECT id,source_id,data FROM evidence WHERE job_id=?")
    .all(input.jobId)
    .map((r) => ({
      ...json<any>(r.data, {}),
      id: String(r.id),
      sourceId: String(r.source_id),
    }))
    .filter((e) => {
      const source = sources.find((s) => s.id === e.sourceId);
      return (
        (!e.eventDate ||
          (Number.isFinite(Date.parse(e.eventDate)) &&
            Date.parse(e.eventDate) <= Date.parse(String(job.cutoff)))) &&
        !!source?.domain &&
        source?.status === "read" &&
        typeof e.quote === "string" &&
        e.quote.trim() &&
        normalize(String(source.text || "")).includes(normalize(e.quote)) &&
        (!source.published ||
          Date.parse(source.published) <= Date.parse(String(job.cutoff)))
      );
    });
  if (
    evidence.length < 3 ||
    new Set(
      evidence.map((e) => sources.find((s) => s.id === e.sourceId)?.domain),
    ).size < 2
  )
    writingError(
      409,
      "写作需要至少三条可追溯原文证据及两个来源域名；知识库不能替代本场证据",
    );
  const knowledge = style.knowledge
    .filter((k: any) => k.enabled)
    .map((k: any) => ({ id: k.id, title: k.title, content: k.content }));
  if (
    knowledge.reduce((n: number, k: any) => n + String(k.content).length, 0) >
    20000
  )
    writingError(
      400,
      "该风格启用知识库合计超过 20000 字，请精简或停用部分条目",
    );
  if (input.thinking) provider.thinking = input.thinking;
  const thinkingProblem = thinkingValidation(provider);
  if (thinkingProblem) writingError(400, thinkingProblem);
  const writingStartedAt = now();
  const fixture = json<any>(job.fixture, {});
  const kickoff = Date.parse(fixture.kickoff);
  const supplementCutoff = new Date(
    Math.min(
      Date.parse(writingStartedAt),
      Number.isFinite(kickoff) ? kickoff : Infinity,
    ),
  ).toISOString();
  const snapshot = {
    ...input,
    writingStartedAt,
    supplementCutoff,
    searchConfig: input.supplementSearch ? searchConfig() : undefined,
    target: lengthTarget(input.durationMinutes, input.charsPerMinute),
    fixture: json(job.fixture, {}),
    direction: job.direction,
    cutoff: job.cutoff,
    researchStatus: job.status,
    report: job.markdown,
    reportAt: job.report_at,
    style: {
      id: style.id,
      name: style.name,
      instructions: style.instructions,
      updatedAt: style.updated_at,
    },
    knowledge,
    provider: {
      id: provider.id,
      model: provider.model,
      type: provider.type,
      thinking: provider.thinking,
      maxTokens: provider.maxTokens,
      timeoutSeconds: provider.timeoutSeconds,
    },
    evidence,
    sources: sources
      .filter((s) => evidence.some((e) => e.sourceId === s.id))
      .map((s) => ({
        id: s.id,
        url: s.url,
        title: s.title,
        domain: s.domain,
        published: s.published,
      })),
  };
  if (JSON.stringify(snapshot).length > 350000)
    writingError(400, "研究材料超出本次写作容量，请选择较小的研究报告");
  const id = uid();
  transaction(() => {
    db.prepare(
      "INSERT INTO writing_runs(id,job_id,provider_id,style_id,created_by,status,input,progress,content,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      input.jobId,
      provider.id,
      style.id,
      userId,
      "queued",
      JSON.stringify(snapshot),
      "{}",
      "",
      now(),
    );
    writingEvent(
      id,
      "created",
      "已手动开始独立写作；研究证据、风格和知识库已冻结",
      { target: snapshot.target, style: style.name },
    );
  });
  return id;
}
export function publicWritingRun(r: any) {
  const out = structuredClone(r);
  if (out.input.searchConfig)
    out.input.searchConfig = publicSearchConfig(out.input.searchConfig);
  return out;
}
