import type { Express, RequestHandler } from "express";
import { db, uid, audit } from "../db.js";
import { now, json } from "../domain.js";
import { StyleSchema, KnowledgeSchema, WritingSchema } from "./domain.js";
import {
  initializeWriting,
  styles,
  writingRun,
  createWriting,
  writingError,
  publicWritingRun,
} from "./repository.js";
import { cancelWriting, writingIsActive } from "./service.js";
export function mountWritingRoutes(
  app: Express,
  permission: (...roles: string[]) => RequestHandler,
  mutateLimit: RequestHandler,
) {
  initializeWriting();
  const base = "/api/writing";
  function styleExists(id: string) {
    if (!db.prepare("SELECT id FROM writing_styles WHERE id=?").get(id))
      writingError(404, "风格不存在");
  }
  function ownRun(id: string, user: any) {
    const r = writingRun(id);
    if (user.role !== "admin" && r.created_by !== user.id)
      writingError(403, "只能操作自己创建的稿件");
    return r;
  }
  function knowledgeLimit(
    styleId: string,
    content: string,
    enabled: boolean,
    except = "",
  ) {
    const current = Number(
      db
        .prepare(
          "SELECT COALESCE(SUM(length(content)),0) AS n FROM writing_knowledge WHERE style_id=? AND enabled=1 AND id<>?",
        )
        .get(styleId, except)?.n,
    );
    if (current + (enabled ? content.length : 0) > 20000)
      writingError(400, "每个风格启用的知识库合计最多 20000 字");
  }
  app.get(base + "/styles", (_req, res) => res.json(styles()));
  app.post(base + "/styles", permission(), mutateLimit, (req, res) => {
    const v = StyleSchema.parse(req.body),
      id = uid();
    db.prepare("INSERT INTO writing_styles VALUES(?,?,?,?,?,?,?,?)").run(
      id,
      v.name,
      v.description,
      v.instructions,
      v.charsPerMinute,
      Number(v.enabled),
      now(),
      now(),
    );
    audit(res.locals.user.id, "writing_style_create", id);
    res.status(201).json({ id });
  });
  app.put(base + "/styles/:id", permission(), mutateLimit, (req, res) => {
    const id = String(req.params.id),
      v = StyleSchema.parse(req.body);
    styleExists(id);
    db.prepare(
      "UPDATE writing_styles SET name=?,description=?,instructions=?,chars_per_minute=?,enabled=?,updated_at=? WHERE id=?",
    ).run(
      v.name,
      v.description,
      v.instructions,
      v.charsPerMinute,
      Number(v.enabled),
      now(),
      id,
    );
    audit(res.locals.user.id, "writing_style_update", id);
    res.json({ ok: true });
  });
  app.delete(base + "/styles/:id", permission(), mutateLimit, (req, res) => {
    const id = String(req.params.id);
    styleExists(id);
    db.prepare("DELETE FROM writing_styles WHERE id=?").run(id);
    audit(res.locals.user.id, "writing_style_delete", id);
    res.json({ ok: true });
  });
  app.post(
    base + "/styles/:id/knowledge",
    permission(),
    mutateLimit,
    (req, res) => {
      const styleId = String(req.params.id),
        v = KnowledgeSchema.parse(req.body),
        id = uid();
      styleExists(styleId);
      knowledgeLimit(styleId, v.content, v.enabled);
      db.prepare("INSERT INTO writing_knowledge VALUES(?,?,?,?,?,?,?)").run(
        id,
        styleId,
        v.title,
        v.content,
        Number(v.enabled),
        now(),
        now(),
      );
      audit(res.locals.user.id, "writing_knowledge_create", id);
      res.status(201).json({ id });
    },
  );
  app.put(base + "/knowledge/:id", permission(), mutateLimit, (req, res) => {
    const id = String(req.params.id),
      v = KnowledgeSchema.parse(req.body);
    const row = db
      .prepare("SELECT style_id FROM writing_knowledge WHERE id=?")
      .get(id);
    if (!row) writingError(404, "知识条目不存在");
    knowledgeLimit(String(row.style_id), v.content, v.enabled, id);
    db.prepare(
      "UPDATE writing_knowledge SET title=?,content=?,enabled=?,updated_at=? WHERE id=?",
    ).run(v.title, v.content, Number(v.enabled), now(), id);
    audit(res.locals.user.id, "writing_knowledge_update", id);
    res.json({ ok: true });
  });
  app.delete(base + "/knowledge/:id", permission(), mutateLimit, (req, res) => {
    if (
      !db
        .prepare("DELETE FROM writing_knowledge WHERE id=?")
        .run(String(req.params.id)).changes
    )
      writingError(404, "知识条目不存在");
    audit(
      res.locals.user.id,
      "writing_knowledge_delete",
      String(req.params.id),
    );
    res.json({ ok: true });
  });
  app.get(base + "/materials", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT jobs.id,jobs.fixture,jobs.direction,jobs.status,reports.created_at AS report_at,(SELECT COUNT(*) FROM evidence WHERE job_id=jobs.id) AS evidence_count FROM jobs JOIN reports ON reports.job_id=jobs.id ORDER BY reports.created_at DESC",
        )
        .all()
        .map((r) => ({ ...r, fixture: json(r.fixture, {}) })),
    ),
  );
  app.get(base + "/runs", (req, res) => {
    const job = typeof req.query.jobId === "string" ? req.query.jobId : "";
    const rows = db
      .prepare(
        "SELECT id,job_id,created_by,status,input,character_count,model_calls,tokens,error,created_at,finished_at FROM writing_runs WHERE (? = ? OR job_id=?) ORDER BY created_at DESC LIMIT 200",
      )
      .all(job, "", job);
    res.json(
      rows.map((r) => {
        const v = json<any>(r.input, {});
        return {
          ...r,
          input: undefined,
          fixture: v.fixture,
          styleName: v.style.name,
          durationMinutes: v.durationMinutes,
          target: v.target,
          charsPerMinute: v.charsPerMinute,
        };
      }),
    );
  });
  app.post(
    base + "/runs",
    permission("researcher"),
    mutateLimit,
    (req, res) => {
      const id = createWriting(
        WritingSchema.parse(req.body),
        res.locals.user.id,
      );
      audit(res.locals.user.id, "writing_create", id);
      res.status(201).json({ id });
    },
  );
  app.get(base + "/runs/:id", (req, res) => {
    const r = writingRun(String(req.params.id));
    res.json({
      ...publicWritingRun(r),
      events: db
        .prepare(
          "SELECT * FROM writing_events WHERE run_id=? ORDER BY id DESC LIMIT 150",
        )
        .all(r.id)
        .map((e) => ({ ...e, data: json(e.data, null) })),
    });
  });
  app.post(
    base + "/runs/:id/cancel",
    permission("researcher"),
    mutateLimit,
    (req, res) => {
      const r = ownRun(String(req.params.id), res.locals.user);
      cancelWriting(r.id);
      audit(res.locals.user.id, "writing_cancel", r.id);
      res.json({ ok: true });
    },
  );
  app.delete(
    base + "/runs/:id",
    permission("researcher"),
    mutateLimit,
    (req, res) => {
      const r = ownRun(String(req.params.id), res.locals.user);
      if (writingIsActive(r.id) || ["queued", "running"].includes(r.status))
        writingError(409, "请先取消写作再删除");
      db.prepare("DELETE FROM writing_runs WHERE id=?").run(r.id);
      audit(res.locals.user.id, "writing_delete", r.id);
      res.json({ ok: true });
    },
  );
  app.get(base + "/runs/:id/export", (req, res) => {
    const r = writingRun(String(req.params.id)),
      format = String(req.query.format || "md"),
      nl = String.fromCharCode(10);
    if (!["md", "txt", "json"].includes(format))
      writingError(400, "不支持的导出格式");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=writing-" + r.id + "." + format,
    );
    if (format === "json") {
      res.json(publicWritingRun(r));
      return;
    }
    if (format === "txt") {
      res.type("text/plain").send(r.content);
      return;
    }
    const citations = (r.progress.paragraphs || [])
      .map(
        (p: any, i: number) =>
          "段落 " + (i + 1) + "：" + (p.evidenceIds || []).join("、"),
      )
      .join(nl + nl);
    const sources = [
      ...(r.input.sources || []),
      ...(r.progress.supplement?.pages || [])
        .filter((p: any) => p.source)
        .map((p: any) => ({
          ...p.source,
          title: "【写作补搜 / " + p.source.status + "】" + p.source.title,
        })),
    ]
      .map((s: any) => "- " + s.title + "：" + s.url)
      .join(nl);
    res
      .type("text/markdown")
      .send(
        [
          "# " + (r.progress.outline?.title || "口播稿"),
          "状态：" +
            r.status +
            "；有效字数：" +
            r.character_count +
            "；风格：" +
            r.input.style.name,
          r.content,
          "## 复核事项",
          (r.progress.issues || []).join(nl),
          "发布前请人工复核事实与最新消息。",
          "## 证据绑定",
          citations,
          "## 写作补搜",
          "补搜资料截至：" +
            (r.input.supplementCutoff || "未启用") +
            "；查询次数：" +
            (r.progress.supplement?.queries?.length || 0),
          (r.progress.supplement?.warnings || []).join(nl),
          "## 证据原文",
          [
            ...(r.input.evidence || []),
            ...(r.progress.supplement?.evidence || []),
          ]
            .map(
              (e: any) =>
                "- " +
                e.id +
                "：" +
                e.claim +
                nl +
                "> " +
                e.quote +
                nl +
                "来源ID：" +
                e.sourceId +
                "；限制：" +
                (e.limitation || "无额外说明"),
            )
            .join(nl + nl),
          "## 来源",
          sources,
        ].join(nl + nl),
      );
  });
}
