import { thinkingConfig } from "./thinking.js";
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { json, now, ResearchSchema, SearchSchema } from "./domain.js";
export const dataDir = path.resolve(process.env.DATA_DIR || "data");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const keyFile = path.join(dataDir, ".encryption-key");
if (!process.env.APP_SECRET && !existsSync(keyFile))
  writeFileSync(keyFile, randomBytes(32).toString("hex"), {
    mode: 0o600,
    flag: "wx",
  });
const keyText = process.env.APP_SECRET || readFileSync(keyFile, "utf8").trim();
if (!/^[a-fA-F0-9]{64}$/.test(keyText))
  throw new Error("APP_SECRET 必须为 64 位十六进制字符串");
const key = Buffer.from(keyText, "hex");
export const db = new DatabaseSync(path.join(dataDir, "touchline.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS search_credentials(id TEXT PRIMARY KEY,kind TEXT NOT NULL,secret TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS providers(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,base_url TEXT NOT NULL,model TEXT NOT NULL,secret TEXT NOT NULL,enabled INTEGER NOT NULL,max_tokens INTEGER NOT NULL,timeout_seconds INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fixtures(id TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,fixture_id TEXT NOT NULL REFERENCES fixtures(id),fixture TEXT NOT NULL,direction TEXT NOT NULL,line TEXT NOT NULL,provider_id TEXT NOT NULL REFERENCES providers(id),status TEXT NOT NULL,stage_index INTEGER NOT NULL DEFAULT 0,queries INTEGER NOT NULL DEFAULT 0,model_calls INTEGER NOT NULL DEFAULT 0,tokens INTEGER NOT NULL DEFAULT 0,config TEXT NOT NULL,search_config TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,cutoff TEXT NOT NULL,run_after TEXT NOT NULL,error TEXT,context TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS stages(job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,stage_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',data TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(job_id,stage_id));
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,url TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(job_id,url));
CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,stage TEXT NOT NULL,source_id TEXT NOT NULL REFERENCES sources(id),data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports(job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,markdown TEXT NOT NULL,script TEXT NOT NULL DEFAULT '',verdict TEXT NOT NULL,confidence TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,type TEXT NOT NULL,message TEXT NOT NULL,data TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,run_after);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id,id);
CREATE INDEX IF NOT EXISTS sources_job ON sources(job_id);
CREATE INDEX IF NOT EXISTS evidence_job ON evidence(job_id);`);
// Existing encrypted providers retain all fields; new thinking settings have safe defaults.
if (
  !db
    .prepare("PRAGMA table_info(providers)")
    .all()
    .some((column) => column.name === "thinking")
) {
  db.exec(
    "ALTER TABLE providers ADD COLUMN thinking TEXT NOT NULL DEFAULT '{}'",
  );
}
export const uid = () => randomUUID();
export function seal(value: string) {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return [
    iv.toString("hex"),
    cipher.update(value, "utf8", "hex") + cipher.final("hex"),
    cipher.getAuthTag().toString("hex"),
  ].join(":");
}
export function unseal(value: string) {
  if (!value) return "";
  const [iv, text, tag] = value.split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return d.update(text, "hex", "utf8") + d.final("utf8");
}
export function passwordHash(value: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(value, salt, 64).toString("hex");
}
export function passwordMatches(value: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const b = Buffer.from(hash, "hex");
  const a = scryptSync(value, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function getSetting<T>(key: string, fallback: T): T {
  const r = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return r ? json(r.value, fallback) : fallback;
}
export function setSetting(key: string, value: unknown) {
  db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify(value));
}
export const researchConfig = () =>
  ResearchSchema.parse(getSetting("research", {}));
export const searchConfig = () => SearchSchema.parse(getSetting("search", {}));
export function audit(userId: string | null, action: string, detail: string) {
  db.prepare(
    "INSERT INTO audit(user_id,action,detail,created_at) VALUES(?,?,?,?)",
  ).run(userId, action, detail, now());
}
export function event(
  jobId: string,
  type: string,
  message: string,
  data?: unknown,
) {
  db.prepare(
    "INSERT INTO events(job_id,type,message,data,created_at) VALUES(?,?,?,?,?)",
  ).run(jobId, type, message, data ? JSON.stringify(data) : null, now());
}
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function publicProvider(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    baseUrl: r.base_url,
    model: r.model,
    enabled: !!r.enabled,
    maxTokens: r.max_tokens,
    timeoutSeconds: r.timeout_seconds,
    thinking: thinkingConfig(json(r.thinking, {})),
    hasKey: !!r.secret,
  };
}
