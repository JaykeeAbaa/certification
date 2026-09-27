import "server-only";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  campaignSchema,
  issues,
  type Campaign,
  type Certificate,
} from "./model";
const globals = globalThis as typeof globalThis & {
  certifyDatabases?: Map<string, DatabaseSync>;
};
export const dataDirectory = () =>
  path.resolve(
    /* turbopackIgnore: true */
    process.env.CERTIFY_DATA_DIR || path.join(process.cwd(), ".certify"),
  );
export function db() {
  const dir = dataDirectory();
  globals.certifyDatabases ??= new Map();
  let connection = globals.certifyDatabases.get(dir);
  if (connection) return connection;
  mkdirSync(path.join(dir, "certificates"), { recursive: true, mode: 0o700 });
  connection = new DatabaseSync(path.join(dir, "workspace.sqlite"));
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,data TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS certificates(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,name TEXT NOT NULL,size INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,last_send INTEGER);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,recipient_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL DEFAULT 0,started_at INTEGER,accepted_at TEXT,error TEXT,UNIQUE(campaign_id,recipient_id));
 CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(status,available_at);
 CREATE TABLE IF NOT EXISTS send_attempts(id INTEGER PRIMARY KEY,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY,name TEXT NOT NULL,design TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY,action TEXT NOT NULL,resource_id TEXT,created_at TEXT NOT NULL);
 PRAGMA user_version=1;`);
  globals.certifyDatabases.set(dir, connection);
  return connection;
}
export function one<T>(sql: string, ...args: SQLInputValue[]): T | undefined {
  return db()
    .prepare(sql)
    .get(...args) as T | undefined;
}
export function all<T>(sql: string, ...args: SQLInputValue[]): T[] {
  return db()
    .prepare(sql)
    .all(...args) as T[];
}
export function execute(sql: string, ...args: SQLInputValue[]) {
  return db()
    .prepare(sql)
    .run(...args);
}
export function transaction<T>(fn: () => T): T {
  db().exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db().exec("COMMIT");
    return result;
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
}
export function audit(action: string, id?: string) {
  execute(
    "INSERT INTO audit_logs(action,resource_id,created_at) VALUES(?,?,?)",
    action,
    id || null,
    new Date().toISOString(),
  );
}
export type StoredCampaign = {
  id: string;
  data: string;
  status: string;
  created_at: string;
};
export function parseCampaign(c: StoredCampaign): Campaign {
  return {
    ...JSON.parse(c.data),
    id: c.id,
    status: c.status,
    created_at: c.created_at,
  };
}
export function getCampaign(id: string) {
  const row = one<StoredCampaign>("SELECT * FROM campaigns WHERE id=?", id);
  if (!row) throw new Error("Campaign not found.");
  return parseCampaign(row);
}
export function saveCampaign(input: Campaign) {
  const c = campaignSchema.parse(input);
  transaction(() => {
    const existing = one<StoredCampaign>(
      "SELECT * FROM campaigns WHERE id=?",
      input.id,
    );
    if (existing && existing.status !== "draft")
      throw new Error("Only draft campaigns can be edited.");
    execute(
      "INSERT INTO campaigns(id,data,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      input.id,
      JSON.stringify(c),
      new Date().toISOString(),
    );
    audit("campaign.saved", input.id);
  });
}
export type StoredCertificate = Omit<Certificate, "path"> & {
  campaign_id: string;
};
export function certificatePath(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid certificate ID.");
  return path.join(dataDirectory(), "certificates", `${id}.pdf`);
}
export function getCertificate(id: string, campaignId?: string) {
  const cert = one<StoredCertificate>(
    "SELECT * FROM certificates WHERE id=?",
    id,
  );
  if (!cert || (campaignId && cert.campaign_id !== campaignId))
    throw new Error("Certificate not found.");
  return cert;
}
export type Sender = {
  host: string;
  port: 465 | 587;
  email: string;
  sender_name: string;
  secret: string;
  per_minute: number;
  daily_limit: number;
  verified: boolean;
};
export function getSender() {
  const row = one<{ data: string }>("SELECT data FROM settings WHERE id=1");
  return row ? (JSON.parse(row.data) as Sender) : null;
}
export function publicSender() {
  const sender = getSender();
  if (!sender) return null;
  const { secret: _, ...publicSettings } = sender;
  return publicSettings;
}
export function putSender(sender: Sender) {
  execute(
    "INSERT INTO settings(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    JSON.stringify(sender),
  );
  audit("sender.verified");
}
function key() {
  db();
  const file = path.join(dataDirectory(), "credential.key");
  if (!existsSync(file)) {
    if (one("SELECT id FROM settings LIMIT 1"))
      throw new Error(
        "The local encryption key is missing. Restore credential.key from your backup.",
      );
    try {
      writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (!existsSync(file)) throw e;
    }
  }
  const value = readFileSync(file);
  if (value.length !== 32)
    throw new Error("The local encryption key is invalid.");
  return value;
}
export function encrypt(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decrypt(secret: string) {
  const data = Buffer.from(secret, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    cipher.update(data.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export function localRequest(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("host") || url.host;
  const parsed = new URL(`http://${host}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
    throw new Error("This workspace is available only on this computer.");
  const origin = req.headers.get("origin");
  if (
    req.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && new URL(origin).host !== host)
  )
    throw new Error("Requests from other websites are not allowed.");
  if (req.method !== "GET" && req.headers.get("x-certify-local") !== "1")
    throw new Error("Open the local Certify app to make changes.");
}
export function launchCampaign(id: string) {
  transaction(() => {
    const c = getCampaign(id);
    if (!["draft", "paused", "complete"].includes(c.status))
      throw new Error("Campaign cannot be launched in its current state.");
    if (!getSender()?.verified)
      throw new Error("Test and save your SMTP sender first.");
    const active = c.recipients.filter((r) => !r.excluded);
    if (!active.length || [...issues(c.recipients).values()].some(Boolean))
      throw new Error("Resolve all recipient issues before sending.");
    for (const r of active) {
      getCertificate(r.certificate!, id);
      if (!existsSync(certificatePath(r.certificate!)))
        throw new Error("A certificate file is missing from this computer.");
      execute(
        "INSERT OR IGNORE INTO jobs(id,campaign_id,recipient_id) VALUES(?,?,?)",
        crypto.randomUUID(),
        id,
        r.id,
      );
    }
    execute("UPDATE campaigns SET status='sending' WHERE id=?", id);
    audit("campaign.launched", id);
  });
}
export function retryFailed(id: string) {
  transaction(() => {
    const c = getCampaign(id);
    if (!["sending", "paused", "complete"].includes(c.status))
      throw new Error("Campaign has not been sent.");
    execute(
      "UPDATE jobs SET status='queued',attempts=0,error=NULL,available_at=0 WHERE campaign_id=? AND status='failed'",
      id,
    );
    execute("UPDATE campaigns SET status='sending' WHERE id=?", id);
    audit("campaign.failed_retried", id);
  });
}
export function deleteCampaign(id: string) {
  transaction(() => {
    const c = getCampaign(id);
    if (
      c.status === "sending" ||
      one("SELECT id FROM jobs WHERE campaign_id=? AND status='processing'", id)
    )
      throw new Error(
        "Pause the campaign and wait for the current email before deleting it.",
      );
    execute("UPDATE campaigns SET status='deleting' WHERE id=?", id);
  });
  for (const cert of all<{ id: string }>(
    "SELECT id FROM certificates WHERE campaign_id=?",
    id,
  ))
    rmSync(certificatePath(cert.id), { force: true });
  execute("DELETE FROM campaigns WHERE id=?", id);
  audit("campaign.deleted", id);
}
export function json(value: unknown) {
  return Response.json(value, { headers: { "Cache-Control": "no-store" } });
}
export function failure(e: unknown) {
  return Response.json(
    { error: e instanceof Error ? e.message : "Request failed." },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
