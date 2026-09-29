import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  db,
  uid,
  hashToken,
  passwordHash,
  passwordMatches,
  seal,
  getSetting,
  setSetting,
  publicProvider,
  audit,
  researchConfig,
  searchConfig,
  transaction,
} from "./db.js";
import {
  STAGES,
  ProviderSchema,
  ResearchSchema,
  SearchSchema,
  FixtureSchema,
  Fixture,
  json,
  now,
  errorMessage,
} from "./domain.js";
import { getProvider, completeJson } from "./models.js";
import { listFixtures, saveFixture, syncFixtures } from "./fixtures.js";
import {
  sourceList,
  evidenceList,
  controlJob,
  updateJobBudget,
  jobIsActive,
} from "./research.js";
import { searchWeb } from "./search.js";
import { validHttpUrl } from "./network.js";
const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(12).max(200),
});
const roles = z.enum(["admin", "researcher", "viewer"]);
const publicUser = (r: any) => ({
  id: r.id,
  username: r.username,
  role: r.role,
  enabled: !!r.enabled,
  createdAt: r.created_at,
});
function error(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
function auth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const token = req.cookies?.touchline_session;
  const u =
    token &&
    db
      .prepare(
        "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires_at>? AND users.enabled=1",
      )
      .get(hashToken(token), now());
  if (!u) {
    res.status(401).json({ error: "请先登录" });
    return;
  }
  res.locals.user = u;
  next();
}
function permission(...allowed: string[]) {
  return (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (
      res.locals.user.role !== "admin" &&
      !allowed.includes(res.locals.user.role)
    ) {
      res.status(403).json({ error: "当前角色没有此操作权限" });
      return;
    }
    next();
  };
}
function ownJob(id: string, user: any) {
  const r = db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  if (!r) error(404, "任务不存在");
  if (user.role !== "admin" && r.created_by !== user.id)
    error(403, "只能操作自己创建的任务");
  return r;
}
function jobSummary(r: any) {
  return {
    ...r,
    fixture: json(r.fixture, {}),
    config: json(r.config, {}),
    search_config: json(r.search_config, {}),
    context: json(r.context, {}),
  };
}
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests:
            process.env.COOKIE_SECURE === "true" ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      const expected = process.env.PUBLIC_URL
        ? new URL(process.env.PUBLIC_URL).host
        : req.get("host");
      let host = "";
      try {
        host = new URL(req.headers.origin).host;
      } catch {}
      if (host !== expected) {
        res.status(403).json({ error: "请求来源不匹配" });
        return;
      }
    }
    next();
  });
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "登录尝试过多，请稍后重试" },
  });
  const mutateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 45,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "操作过于频繁，请稍后重试" },
  });
  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, version: "1.0.0", time: now() });
  });
  app.get("/api/auth/status", (req, res) => {
    const initialized = !!db.prepare("SELECT id FROM users LIMIT 1").get();
    const token = req.cookies?.touchline_session;
    const u =
      token &&
      db
        .prepare(
          "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires_at>? AND users.enabled=1",
        )
        .get(hashToken(token), now());
    res.json({ initialized, user: u ? publicUser(u) : null });
  });
  app.post("/api/auth/setup", loginLimit, (req, res) => {
    if (db.prepare("SELECT id FROM users LIMIT 1").get())
      error(409, "管理员已经初始化");
    const input = credentials
      .extend({ setupToken: z.string() })
      .parse(req.body);
    const expected = process.env.SETUP_TOKEN;
    if (!expected) error(503, "未配置 SETUP_TOKEN，请先运行 npm run setup");
    const a = Buffer.from(hashToken(input.setupToken)),
      b = Buffer.from(hashToken(expected));
    if (!timingSafeEqual(a, b)) error(403, "初始化令牌无效");
    const id = uid();
    db.prepare(
      "INSERT INTO users(id,username,password,role,created_at) VALUES(?,?,?,?,?)",
    ).run(id, input.username, passwordHash(input.password), "admin", now());
    audit(id, "setup", "创建首个管理员");
    res.status(201).json({ ok: true });
  });
  app.post("/api/auth/login", loginLimit, (req, res) => {
    const input = z
      .object({ username: z.string().max(40), password: z.string().max(200) })
      .parse(req.body);
    const u = db
      .prepare("SELECT * FROM users WHERE username=? AND enabled=1")
      .get(input.username);
    const valid = passwordMatches(
      input.password,
      u ? String(u.password) : passwordHash("dummy-password-for-timing"),
    );
    if (!u || !valid) error(401, "用户名或密码错误");
    const token = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now());
    db.prepare(
      "INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)",
    ).run(
      hashToken(token),
      u.id,
      new Date(Date.now() + 7 * 86400000).toISOString(),
    );
    res.cookie("touchline_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 7 * 86400000,
      path: "/",
    });
    audit(String(u.id), "login", "登录后台");
    res.json({ user: publicUser(u) });
  });
  app.post("/api/auth/logout", auth, (req, res) => {
    if (req.cookies.touchline_session)
      db.prepare("DELETE FROM sessions WHERE token=?").run(
        hashToken(req.cookies.touchline_session),
      );
    res.clearCookie("touchline_session", { path: "/" });
    res.json({ ok: true });
  });
  app.use("/api", auth);
  app.post("/api/auth/password", mutateLimit, (req, res) => {
    const input = z
      .object({
        oldPassword: z.string(),
        newPassword: z.string().min(12).max(200),
      })
      .parse(req.body);
    if (!passwordMatches(input.oldPassword, res.locals.user.password))
      error(400, "当前密码错误");
    transaction(() => {
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        passwordHash(input.newPassword),
        res.locals.user.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(
        res.locals.user.id,
      );
    });
    audit(res.locals.user.id, "password", "修改密码并撤销全部会话");
    res.clearCookie("touchline_session", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/dashboard", (_req, res) => {
    const counts = db
      .prepare("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status")
      .all();
    res.json({
      counts,
      fixtures: Number(
        db.prepare("SELECT COUNT(*) AS n FROM fixtures").get()?.n || 0,
      ),
      evidence: Number(
        db.prepare("SELECT COUNT(*) AS n FROM evidence").get()?.n || 0,
      ),
      reports: Number(
        db.prepare("SELECT COUNT(*) AS n FROM reports").get()?.n || 0,
      ),
      tokens: Number(
        db.prepare("SELECT SUM(tokens) AS n FROM jobs").get()?.n || 0,
      ),
      recent: db
        .prepare(
          "SELECT jobs.*,providers.name AS provider_name FROM jobs JOIN providers ON jobs.provider_id=providers.id ORDER BY created_at DESC LIMIT 6",
        )
        .all()
        .map(jobSummary),
      lastSync: getSetting("lastSync", null),
      modelCount: Number(
        db.prepare("SELECT COUNT(*) AS n FROM providers WHERE enabled=1").get()
          ?.n || 0,
      ),
      search: searchConfig().engine,
      stages: STAGES,
    });
  });
  app.get("/api/providers", (_req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM providers ORDER BY created_at")
        .all()
        .map(publicProvider),
    ),
  );
  app.post("/api/providers", permission(), mutateLimit, (req, res) => {
    const p = ProviderSchema.parse(req.body);
    validHttpUrl(p.baseUrl);
    const id = uid();
    db.prepare(
      "INSERT INTO providers(id,name,type,base_url,model,secret,enabled,max_tokens,timeout_seconds,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      p.name,
      p.type,
      p.baseUrl.replace(/\/$/, ""),
      p.model,
      seal(p.apiKey || ""),
      Number(p.enabled),
      p.maxTokens,
      p.timeoutSeconds,
      now(),
    );
    audit(res.locals.user.id, "provider_create", p.name);
    res.status(201).json({ id });
  });
  app.put("/api/providers/:id", permission(), mutateLimit, (req, res) => {
    const p = ProviderSchema.parse(req.body),
      r = db
        .prepare("SELECT * FROM providers WHERE id=?")
        .get(String(req.params.id));
    if (!r) error(404, "模型配置不存在");
    validHttpUrl(p.baseUrl);
    const secret =
      p.apiKey === undefined || p.apiKey === "" ? r.secret : seal(p.apiKey);
    db.prepare(
      "UPDATE providers SET name=?,type=?,base_url=?,model=?,secret=?,enabled=?,max_tokens=?,timeout_seconds=? WHERE id=?",
    ).run(
      p.name,
      p.type,
      p.baseUrl.replace(/\/$/, ""),
      p.model,
      secret,
      Number(p.enabled),
      p.maxTokens,
      p.timeoutSeconds,
      String(req.params.id),
    );
    audit(res.locals.user.id, "provider_update", p.name);
    res.json({ ok: true });
  });
  app.delete("/api/providers/:id", permission(), (req, res) => {
    if (
      db
        .prepare("SELECT id FROM jobs WHERE provider_id=? LIMIT 1")
        .get(String(req.params.id))
    )
      error(409, "模型已有任务引用，请停用而非删除");
    db.prepare("DELETE FROM providers WHERE id=?").run(String(req.params.id));
    audit(res.locals.user.id, "provider_delete", String(req.params.id));
    res.json({ ok: true });
  });
  app.post(
    "/api/providers/:id/test",
    permission(),
    mutateLimit,
    async (req, res) => {
      const start = Date.now();
      const p = getProvider(String(req.params.id));
      await completeJson(
        p,
        '连接测试：只返回JSON对象 {"ok":true}',
        z.object({ ok: z.literal(true) }),
      );
      res.json({ ok: true, latency: Date.now() - start, model: p.model });
    },
  );
  app.get("/api/settings", permission(), (_req, res) =>
    res.json({
      research: researchConfig(),
      search: searchConfig(),
      fixtures: getSetting("fixtures", { mode: "sporttery", redBlackUrl: "" }),
    }),
  );
  app.put("/api/settings/:key", permission(), mutateLimit, (req, res) => {
    const key = String(req.params.key);
    let value: unknown;
    if (key === "research") value = ResearchSchema.parse(req.body);
    else if (key === "search") {
      value = SearchSchema.parse(req.body);
      validHttpUrl((value as any).searxngUrl);
    } else if (key === "fixtures") {
      value = z
        .object({
          mode: z.enum(["sporttery", "redblack"]),
          redBlackUrl: z.string().max(500),
        })
        .parse(req.body);
      if ((value as any).mode === "redblack")
        validHttpUrl((value as any).redBlackUrl);
    } else error(400, "未知配置项");
    setSetting(key, value);
    audit(res.locals.user.id, "settings_update", key);
    res.json({ ok: true });
  });
  app.post("/api/search/test", permission(), mutateLimit, async (req, res) => {
    const q = z.object({ query: z.string().min(3).max(300) }).parse(req.body);
    const start = Date.now();
    const r = await searchWeb(q.query, searchConfig());
    res.json({ ...r, latency: Date.now() - start, ok: r.hits.length > 0 });
  });
  app.get("/api/fixtures", (_req, res) =>
    res.json({ items: listFixtures(), lastSync: getSetting("lastSync", null) }),
  );
  app.post(
    "/api/fixtures/sync",
    permission("researcher"),
    mutateLimit,
    async (_req, res) => {
      const result = await syncFixtures();
      audit(res.locals.user.id, "fixtures_sync", String(result.count));
      res.json(result);
    },
  );
  app.post(
    "/api/fixtures",
    permission("researcher"),
    mutateLimit,
    (req, res) => {
      const f = FixtureSchema.parse(req.body);
      const id = "manual-" + uid();
      saveFixture({
        ...f,
        kickoff: new Date(f.kickoff).toISOString(),
        id,
        source: "manual",
        updatedAt: now(),
      });
      audit(res.locals.user.id, "fixture_create", f.home + " vs " + f.away);
      res.status(201).json({ id });
    },
  );
  app.put(
    "/api/fixtures/:id",
    permission("researcher"),
    mutateLimit,
    (req, res) => {
      const id = String(req.params.id),
        row = db.prepare("SELECT data FROM fixtures WHERE id=?").get(id);
      if (!row) error(404, "比赛不存在");
      const original = json<Fixture>(row.data, {} as Fixture);
      if (!["manual", "import"].includes(original.source))
        error(409, "同步比赛由上游维护，请另建手动比赛");
      const f = FixtureSchema.parse(req.body);
      saveFixture({
        ...original,
        ...f,
        kickoff: new Date(f.kickoff).toISOString(),
        updatedAt: now(),
      });
      audit(res.locals.user.id, "fixture_update", id);
      res.json({ ok: true });
    },
  );
  app.delete("/api/fixtures/:id", permission(), mutateLimit, (req, res) => {
    const id = String(req.params.id);
    if (db.prepare("SELECT id FROM jobs WHERE fixture_id=? LIMIT 1").get(id))
      error(409, "比赛已有研究任务，不能删除");
    db.prepare("DELETE FROM fixtures WHERE id=?").run(id);
    audit(res.locals.user.id, "fixture_delete", id);
    res.json({ ok: true });
  });
  app.post(
    "/api/fixtures/import",
    permission("researcher"),
    mutateLimit,
    (req, res) => {
      const fixtures = z.array(FixtureSchema).min(1).max(100).parse(req.body);
      transaction(() =>
        fixtures.forEach((f) =>
          saveFixture({
            ...f,
            kickoff: new Date(f.kickoff).toISOString(),
            id: "manual-" + uid(),
            source: "import",
            updatedAt: now(),
          }),
        ),
      );
      audit(res.locals.user.id, "fixtures_import", String(fixtures.length));
      res.json({ count: fixtures.length });
    },
  );
  app.get("/api/jobs", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT jobs.*,providers.name AS provider_name,reports.verdict FROM jobs JOIN providers ON providers.id=jobs.provider_id LEFT JOIN reports ON reports.job_id=jobs.id ORDER BY created_at DESC LIMIT 500",
        )
        .all()
        .map(jobSummary),
    ),
  );
  app.post("/api/jobs", permission("researcher"), mutateLimit, (req, res) => {
    const input = z
      .object({
        fixtureId: z.string(),
        direction: z.string().trim().min(2).max(1500),
        line: z.string().max(200).default(""),
        providerId: z.string(),
        runAfter: z.string().datetime({ offset: true }).optional(),
      })
      .parse(req.body);
    getProvider(input.providerId);
    const row = db
      .prepare("SELECT data FROM fixtures WHERE id=?")
      .get(input.fixtureId);
    if (!row) error(404, "比赛不存在");
    const fixture = json<Fixture>(row.data, {} as Fixture);
    if (fixture.kickoff <= now())
      error(400, "赛前研究仅支持尚未开球的比赛，请核对日期");
    const runAfter = input.runAfter
      ? new Date(input.runAfter).toISOString()
      : now();
    if (runAfter >= fixture.kickoff) error(400, "研究启动时间必须早于开球时间");
    const id = uid();
    transaction(() => {
      db.prepare(
        "INSERT INTO jobs(id,fixture_id,fixture,direction,line,provider_id,status,config,search_config,created_by,created_at,cutoff,run_after) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        input.fixtureId,
        row.data,
        input.direction,
        input.line,
        input.providerId,
        "queued",
        JSON.stringify(researchConfig()),
        JSON.stringify(searchConfig()),
        res.locals.user.id,
        now(),
        now(),
        runAfter,
      );
      for (const s of STAGES)
        db.prepare("INSERT INTO stages(job_id,stage_id) VALUES(?,?)").run(
          id,
          s.id,
        );
    });
    audit(res.locals.user.id, "job_create", id);
    res.status(201).json({ id });
  });
  app.get("/api/jobs/:id", (req, res) => {
    const id = String(req.params.id),
      r = db
        .prepare(
          "SELECT jobs.*,providers.name AS provider_name FROM jobs JOIN providers ON providers.id=jobs.provider_id WHERE jobs.id=?",
        )
        .get(id);
    if (!r) error(404, "任务不存在");
    res.json({
      ...jobSummary(r),
      stages: db
        .prepare("SELECT * FROM stages WHERE job_id=?")
        .all(id)
        .map((s) => ({ ...s, data: json(s.data, {}) })),
      sources: sourceList(id).map(({ text, ...s }) => s),
      evidence: evidenceList(id),
      events: db
        .prepare(
          "SELECT * FROM (SELECT * FROM events WHERE job_id=? ORDER BY id DESC LIMIT 250) ORDER BY id",
        )
        .all(id)
        .map((e) => ({ ...e, data: json(e.data, null) })),
      report:
        db.prepare("SELECT * FROM reports WHERE job_id=?").get(id) || null,
    });
  });
  app.patch(
    "/api/jobs/:id/budget",
    permission("researcher"),
    mutateLimit,
    (req, res) => {
      const id = String(req.params.id);
      ownJob(id, res.locals.user);
      const input = ResearchSchema.pick({
        maxQueries: true,
        maxModelCalls: true,
        maxRunMinutes: true,
      })
        .extend({ retryGaps: z.boolean().default(false) })
        .parse(req.body);
      updateJobBudget(id, input);
      audit(res.locals.user.id, "job_budget", id);
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/jobs/:id/:action",
    permission("researcher"),
    mutateLimit,
    (req, res) => {
      const id = String(req.params.id);
      ownJob(id, res.locals.user);
      const action = z
        .enum(["pause", "cancel", "resume", "retry"])
        .parse(req.params.action);
      controlJob(id, action);
      audit(res.locals.user.id, "job_" + action, id);
      res.json({ ok: true });
    },
  );
  app.delete("/api/jobs/:id", permission("researcher"), (req, res) => {
    const id = String(req.params.id);
    const r = ownJob(id, res.locals.user);
    if (jobIsActive(id) || ["running", "queued"].includes(String(r.status)))
      error(409, "请先停止任务再删除");
    db.prepare("DELETE FROM jobs WHERE id=?").run(id);
    audit(res.locals.user.id, "job_delete", id);
    res.json({ ok: true });
  });
  app.get("/api/reports", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT reports.*,jobs.fixture,jobs.direction,jobs.status FROM reports JOIN jobs ON jobs.id=reports.job_id ORDER BY reports.created_at DESC LIMIT 500",
        )
        .all()
        .map((r) => ({
          ...r,
          fixture: json(r.fixture, {}),
          markdown: undefined,
          script: undefined,
        })),
    ),
  );
  app.get("/api/reports/:id/export", (req, res) => {
    const id = String(req.params.id);
    const report = db.prepare("SELECT * FROM reports WHERE job_id=?").get(id);
    if (!report) error(404, "报告尚未生成");
    const format = req.query.format || "md";
    if (!["md", "json", "script"].includes(String(format)))
      error(400, "不支持此导出格式");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="touchline-' +
        id +
        "." +
        (format === "json" ? "json" : "md") +
        '"',
    );
    if (format === "json")
      res.json({
        report,
        job: jobSummary(db.prepare("SELECT * FROM jobs WHERE id=?").get(id)),
        stages: db
          .prepare("SELECT * FROM stages WHERE job_id=?")
          .all(id)
          .map((s) => ({ ...s, data: json(s.data, {}) })),
        evidence: evidenceList(id),
        sources: sourceList(id),
      });
    else
      res
        .type("text/markdown; charset=utf-8")
        .send(format === "script" ? report.script : report.markdown);
  });
  app.get("/api/evidence", (req, res) => {
    const rows = db
      .prepare(
        "SELECT evidence.*,jobs.fixture,jobs.direction FROM evidence JOIN jobs ON jobs.id=evidence.job_id ORDER BY evidence.rowid DESC LIMIT 500",
      )
      .all();
    res.json(
      rows.map((r) => ({
        ...json<any>(r.data, {}),
        jobId: r.job_id,
        fixture: json(r.fixture, {}),
        direction: r.direction,
        source: {
          ...json<any>(
            db
              .prepare("SELECT data FROM sources WHERE id=?")
              .get(String(r.source_id))?.data,
            {},
          ),
          text: undefined,
        },
      })),
    );
  });
  app.get("/api/sources/:id", (req, res) => {
    const r = db
      .prepare("SELECT data FROM sources WHERE id=?")
      .get(String(req.params.id));
    if (!r) error(404, "来源不存在");
    res.json(json(r.data, {}));
  });
  app.get("/api/users", permission(), (_req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM users ORDER BY created_at")
        .all()
        .map(publicUser),
    ),
  );
  app.post("/api/users", permission(), mutateLimit, (req, res) => {
    const input = credentials
      .extend({ role: roles, enabled: z.boolean().default(true) })
      .parse(req.body);
    if (db.prepare("SELECT id FROM users WHERE username=?").get(input.username))
      error(409, "用户名已存在");
    const id = uid();
    db.prepare(
      "INSERT INTO users(id,username,password,role,created_at) VALUES(?,?,?,?,?)",
    ).run(id, input.username, passwordHash(input.password), input.role, now());
    db.prepare("UPDATE users SET enabled=? WHERE id=?").run(
      Number(input.enabled),
      id,
    );
    audit(res.locals.user.id, "user_create", input.username);
    res.status(201).json({ id });
  });
  app.patch("/api/users/:id", permission(), mutateLimit, (req, res) => {
    const input = z
        .object({
          enabled: z.boolean().optional(),
          role: roles.optional(),
          password: z.string().min(12).max(200).optional(),
        })
        .parse(req.body),
      id = String(req.params.id),
      u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!u) error(404, "账户不存在");
    const role = input.role || String(u.role),
      enabled =
        input.enabled === undefined ? Number(u.enabled) : Number(input.enabled);
    if (
      u.role === "admin" &&
      u.enabled &&
      (role !== "admin" || !enabled) &&
      Number(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND enabled=1",
          )
          .get()?.n,
      ) <= 1
    )
      error(409, "必须保留至少一个启用的管理员");
    transaction(() => {
      db.prepare("UPDATE users SET role=?,enabled=?,password=? WHERE id=?").run(
        role,
        enabled,
        input.password ? passwordHash(input.password) : u.password,
        id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    });
    audit(res.locals.user.id, "user_update", String(u.username));
    res.json({ ok: true });
  });
  app.get("/api/audit", permission(), (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT audit.*,users.username FROM audit LEFT JOIN users ON users.id=audit.user_id ORDER BY audit.id DESC LIMIT 300",
        )
        .all(),
    ),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  const frontend = path.resolve("dist/client");
  if (existsSync(frontend)) {
    app.use(express.static(frontend));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(frontend, "index.html")),
    );
  }
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = err instanceof z.ZodError ? 400 : err.status || 502;
      res
        .status(status)
        .json({
          error:
            err instanceof z.ZodError
              ? err.issues
                  .map((i) => i.path.join(".") + "：" + i.message)
                  .join("；")
              : errorMessage(err).slice(0, 1200),
        });
    },
  );
  return app;
}
