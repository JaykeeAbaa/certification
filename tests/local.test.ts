import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { newCampaign } from "../src/lib/model";
const smtp = vi.hoisted(() => ({
  verify: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../src/lib/smtp", () => ({ transport: vi.fn(async () => smtp) }));
vi.mock("../src/lib/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/queue")>()),
  startWorker: vi.fn(),
}));
import {
  db,
  dataDirectory,
  encrypt,
  decrypt,
  localRequest,
  saveCampaign,
  getCampaign,
  execute,
  one,
  all,
  putSender,
  getSender,
  publicSender,
  certificatePath,
  launchCampaign,
  retryFailed,
  deleteCampaign,
} from "../src/lib/server";
import {
  claimNext,
  deliver,
  finishCampaigns,
  recoverInterrupted,
} from "../src/lib/queue";
import { POST, GET } from "../src/app/api/workspace/route";
import { POST as upload } from "../src/app/api/upload/route";
let temp: string;
beforeEach(() => {
  temp = mkdtempSync(path.join(tmpdir(), "certify-test-"));
  process.env.CERTIFY_DATA_DIR = temp;
  vi.clearAllMocks();
  smtp.verify.mockResolvedValue(true);
  smtp.sendMail.mockResolvedValue({ accepted: ["alex@example.com"] });
});
afterEach(() => {
  db().close();
  const g = globalThis as typeof globalThis & {
    certifyDatabases?: Map<string, unknown>;
  };
  g.certifyDatabases?.delete(dataDirectory());
  delete process.env.CERTIFY_DATA_DIR;
  const root = path.resolve(tmpdir()) + path.sep;
  if (
    !path.resolve(temp).startsWith(root) ||
    !path.basename(temp).startsWith("certify-test-")
  )
    throw new Error("Unexpected test directory");
  rmSync(temp, { recursive: true, force: true });
});
const request = (body: unknown) =>
  new Request("http://127.0.0.1:3000/api/workspace", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Certify-Local": "1",
      Origin: "http://127.0.0.1:3000",
    },
    body: JSON.stringify(body),
  });
const settings = {
  host: "smtp.gmail.com",
  port: 465 as const,
  email: "sender@example.com",
  sender_name: "DICT",
  password: "test app password",
  per_minute: 30,
  daily_limit: 100,
};
function seed() {
  const c = newCampaign();
  const cert = crypto.randomUUID();
  c.recipients = [
    {
      id: crypto.randomUUID(),
      name: "Alex",
      email: "alex@example.com",
      certificates: [cert],
      excluded: false,
    },
  ];
  saveCampaign(c);
  writeFileSync(certificatePath(cert), "%PDF-fictional");
  execute(
    "INSERT INTO certificates(id,campaign_id,name,size) VALUES(?,?,?,?)",
    cert,
    c.id,
    "Alex.pdf",
    14,
  );
  putSender({
    ...settings,
    secret: encrypt(settings.password),
    verified: true,
  });
  launchCampaign(c.id);
  return c;
}
describe("No-account local workspace", () => {
  it("allows local access without authentication and rejects remote websites", () => {
    expect(() => localRequest(request({}))).not.toThrow();
    expect(() =>
      localRequest(new Request("http://evil.test/api/workspace")),
    ).toThrow();
    expect(() =>
      localRequest(
        new Request("http://127.0.0.1:3000/api/workspace", {
          method: "POST",
          headers: { Origin: "https://evil.test", "X-Certify-Local": "1" },
        }),
      ),
    ).toThrow();
    expect(() =>
      localRequest(
        new Request("http://localhost:3000/api/workspace", { method: "POST" }),
      ),
    ).toThrow();
  });
  it("generates its own encryption key, detects tampering and keeps credentials out of responses", async () => {
    const res = await POST(request({ action: "smtp", settings }));
    expect(res.status).toBe(200);
    expect(smtp.verify).toHaveBeenCalledOnce();
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(decrypt(getSender()!.secret)).toBe("testapppassword");
    expect(existsSync(path.join(temp, "credential.key"))).toBe(true);
    const encrypted = encrypt("private");
    const bytes = Buffer.from(encrypted, "base64");
    bytes[20] ^= 1;
    expect(() => decrypt(bytes.toString("base64"))).toThrow();
    expect(publicSender()).not.toHaveProperty("secret");
    expect(
      await (
        await GET(new Request("http://localhost:3000/api/workspace"))
      ).text(),
    ).not.toContain("testapppassword");
  });
  it("returns an SMTP error rather than a sign-in error and preserves saved settings", async () => {
    await POST(request({ action: "smtp", settings }));
    smtp.verify.mockRejectedValueOnce(new Error("test rejection"));
    const result = await POST(
      request({
        action: "smtp",
        settings: { ...settings, email: "new@example.com" },
      }),
    );
    expect(result.status).toBe(400);
    expect((await result.json()).error).toContain("Connection failed");
    expect(getSender()!.email).toBe("sender@example.com");
  });
  it("saves PDFs and campaigns across database reopening, then deletes local files", async () => {
    const c = newCampaign();
    const save = await POST(request({ action: "save", campaign: c }));
    expect(save.status).toBe(200);
    const form = new FormData();
    form.set("campaignId", c.id);
    form.set(
      "file",
      new File(["%PDF-sample"], "Alex.pdf", { type: "application/pdf" }),
    );
    const result = await upload(
      new Request("http://localhost:3000/api/upload", {
        method: "POST",
        headers: { "X-Certify-Local": "1" },
        body: form,
      }),
    );
    expect(result.status).toBe(200);
    const cert = (await result.json()).certificate;
    expect(existsSync(certificatePath(cert.id))).toBe(true);
    db().close();
    (
      globalThis as typeof globalThis & {
        certifyDatabases?: Map<string, unknown>;
      }
    ).certifyDatabases?.delete(dataDirectory());
    expect(getCampaign(c.id).title).toBe(c.title);
    expect(all("SELECT * FROM certificates")).toHaveLength(1);
    deleteCampaign(c.id);
    expect(existsSync(certificatePath(cert.id))).toBe(false);
  });
});
describe("Local durable sender", () => {
  it("claims once, sends the matching attachment, and does not resend on resume", async () => {
    const c = seed();
    const job = claimNext()!;
    expect(job).toBeTruthy();
    expect(claimNext()).toBeUndefined();
    await deliver(job);
    expect(smtp.sendMail.mock.calls[0][0].to).toBe("alex@example.com");
    expect(
      smtp.sendMail.mock.calls[0][0].attachments[0].content.toString(),
    ).toBe("%PDF-fictional");
    finishCampaigns();
    expect(getCampaign(c.id).status).toBe("complete");
    launchCampaign(c.id);
    execute("UPDATE settings SET last_send=NULL");
    expect(claimNext()).toBeUndefined();
    expect(all("SELECT * FROM jobs")).toHaveLength(1);
  });
  it("pauses claims and counts retries against the rolling daily quota", () => {
    const c = seed();
    execute("UPDATE campaigns SET status='paused' WHERE id=?", c.id);
    expect(claimNext()).toBeUndefined();
    launchCampaign(c.id);
    const sender = getSender()!;
    putSender({ ...sender, daily_limit: 1 });
    expect(claimNext()).toBeTruthy();
    execute("UPDATE jobs SET status='failed'");
    retryFailed(c.id);
    execute("UPDATE settings SET last_send=NULL");
    expect(claimNext()).toBeUndefined();
  });
  it("retries confirmed temporary rejection and never automatically retries uncertain sends", async () => {
    const c = seed();
    smtp.sendMail.mockRejectedValueOnce(
      Object.assign(new Error("temporary"), { responseCode: 451 }),
    );
    await deliver(claimNext()!);
    expect(one<{ status: string }>("SELECT status FROM jobs")!.status).toBe(
      "queued",
    );
    execute("UPDATE jobs SET available_at=0");
    execute("UPDATE settings SET last_send=NULL");
    smtp.sendMail.mockRejectedValueOnce(
      new Error("connection lost after DATA"),
    );
    await deliver(claimNext()!);
    expect(one<{ status: string }>("SELECT status FROM jobs")!.status).toBe(
      "uncertain",
    );
    retryFailed(c.id);
    expect(one<{ status: string }>("SELECT status FROM jobs")!.status).toBe(
      "uncertain",
    );
  });
  it("marks interrupted processing uncertain on recovery", () => {
    seed();
    claimNext();
    execute("UPDATE jobs SET started_at=?", Date.now() - 600000);
    recoverInterrupted();
    expect(one<{ status: string }>("SELECT status FROM jobs")!.status).toBe(
      "uncertain",
    );
  });
});
