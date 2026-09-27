import { z } from "zod";
import { readFileSync } from "node:fs";
import {
  localRequest,
  all,
  one,
  execute,
  transaction,
  parseCampaign,
  getCampaign,
  saveCampaign,
  publicSender,
  getSender,
  putSender,
  encrypt,
  audit,
  launchCampaign,
  retryFailed,
  deleteCampaign,
  getCertificate,
  certificatePath,
  json,
  failure,
  type StoredCampaign,
} from "@/lib/server";
import { designSchema, personalize, renderEmail } from "@/lib/model";
import { transport } from "@/lib/smtp";
import { startWorker } from "@/lib/queue";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    localRequest(req);
    startWorker();
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const campaign = getCampaign(z.uuid().parse(id));
      return json({
        campaign,
        certificates: all<{ id: string; name: string; size: number }>(
          "SELECT id,name,size FROM certificates WHERE campaign_id=?",
          id,
        ).map((c) => ({ ...c, path: `/api/certificate?id=${c.id}` })),
        jobs: all(
          "SELECT id,recipient_id,status,attempts,error,accepted_at FROM jobs WHERE campaign_id=?",
          id,
        ),
      });
    }
    return json({
      campaigns: all<StoredCampaign>(
        "SELECT * FROM campaigns ORDER BY created_at DESC",
      ).map(parseCampaign),
      templates: all<{ id: string; name: string; design: string }>(
        "SELECT * FROM templates ORDER BY rowid DESC",
      ).map((t) => ({ ...t, design: JSON.parse(t.design) })),
      smtp: publicSender(),
      logs: all("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50"),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    localRequest(req);
    startWorker();
    const body = await req.json();
    const action = z.string().parse(body.action);
    if (action === "save") {
      z.uuid().parse(body.campaign.id);
      saveCampaign(body.campaign);
      return json({ id: body.campaign.id });
    }
    if (action === "template") {
      const name = z.string().trim().min(1).max(100).parse(body.name),
        design = designSchema.parse(body.design);
      execute(
        "INSERT INTO templates(id,name,design) VALUES(?,?,?)",
        crypto.randomUUID(),
        name,
        JSON.stringify(design),
      );
      return json({ ok: true });
    }
    if (action === "smtp") {
      const settings = z
        .object({
          host: z
            .string()
            .trim()
            .regex(/^[a-zA-Z0-9.-]+$/)
            .max(253),
          port: z.union([z.literal(465), z.literal(587)]),
          email: z.email(),
          sender_name: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .refine((v) => !/[\r\n]/.test(v)),
          password: z.string().max(500),
          per_minute: z.number().int().min(1).max(30),
          daily_limit: z.number().int().min(1).max(2000),
        })
        .parse(body.settings);
      if (settings.host.toLowerCase() === "smtp.gmail.com")
        settings.password = settings.password.replace(/\s/g, "");
      const secret = settings.password
        ? encrypt(settings.password)
        : getSender()?.secret;
      if (!secret) throw new Error("Enter your email app password.");
      const { password: _, ...s } = settings;
      const sender = { ...s, secret, verified: true };
      const smtp = await transport(sender);
      try {
        await smtp.verify();
      } catch {
        throw new Error(
          "Connection failed. Check the SMTP host, port, email address and app password.",
        );
      } finally {
        smtp.close();
      }
      putSender(sender);
      return json({ ok: true });
    }
    if (action === "preview-file") {
      const cert = getCertificate(z.uuid().parse(body.id));
      return json({ url: `/api/certificate?id=${cert.id}` });
    }
    const id = z.uuid().parse(body.id),
      c = getCampaign(id);
    if (action === "launch") {
      launchCampaign(id);
      return json({ ok: true });
    }
    if (action === "pause") {
      execute(
        "UPDATE campaigns SET status='paused' WHERE id=? AND status='sending'",
        id,
      );
      audit("campaign.paused", id);
      return json({ ok: true });
    }
    if (action === "retry") {
      retryFailed(id);
      return json({ ok: true });
    }
    if (action === "delete") {
      deleteCampaign(id);
      return json({ ok: true });
    }
    if (action === "test") {
      const sender = getSender();
      if (!sender?.verified)
        throw new Error("Test and save your SMTP sender first.");
      transaction(() => {
        if (
          one(
            "SELECT id FROM audit_logs WHERE action='email.test' AND created_at>?",
            new Date(Date.now() - 60000).toISOString(),
          )
        )
          throw new Error("Wait one minute between test emails.");
        if (
          one<{ n: number }>(
            "SELECT count(*) AS n FROM send_attempts WHERE created_at>?",
            Date.now() - 86400000,
          )!.n >= sender.daily_limit
        )
          throw new Error("Your daily sending limit has been reached.");
        execute("INSERT INTO send_attempts(created_at) VALUES(?)", Date.now());
        execute("UPDATE settings SET last_send=? WHERE id=1", Date.now());
        audit("email.test", id);
      });
      const r = c.recipients.find((r) => !r.excluded);
      const attachments = [];
      if (r?.certificate) {
        const cert = getCertificate(r.certificate, id);
        attachments.push({
          filename: cert.name,
          content: readFileSync(certificatePath(cert.id)),
          contentType: "application/pdf",
        });
      }
      const smtp = await transport(sender);
      try {
        await smtp.sendMail({
          from: { name: sender.sender_name, address: sender.email },
          to: sender.email,
          subject:
            "[TEST] " +
            personalize(c.subject, c, r?.name || "Training participant"),
          ...renderEmail(c, r?.name || "Training participant"),
          attachments,
        });
      } catch {
        throw new Error(
          "Test email was not confirmed. Check provider sent-mail records before retrying.",
        );
      } finally {
        smtp.close();
      }
      return json({ ok: true });
    }
    throw new Error("Unknown action.");
  } catch (e) {
    return failure(e);
  }
}
