import "server-only";
import { readFileSync } from "node:fs";
import {
  one,
  all,
  execute,
  transaction,
  getSender,
  getCampaign,
  getCertificate,
  certificatePath,
  deleteCampaign,
  parseCampaign,
  type StoredCampaign,
} from "./server";
import { personalize, renderEmail } from "./model";
import { transport } from "./smtp";
export type LocalJob = {
  id: string;
  campaign_id: string;
  recipient_id: string;
  attempts: number;
  status: string;
};
export function claimNext(now = Date.now()): LocalJob | undefined {
  return transaction(() => {
    const sender = getSender();
    if (!sender?.verified) return;
    const last = one<{ last_send: number | null }>(
      "SELECT last_send FROM settings WHERE id=1",
    )?.last_send;
    if (last && now - last < 60000 / sender.per_minute) return;
    if (
      one<{ n: number }>(
        "SELECT count(*) AS n FROM send_attempts WHERE created_at>?",
        now - 86400000,
      )!.n >= sender.daily_limit
    )
      return;
    const job = one<LocalJob>(
      "SELECT j.* FROM jobs j JOIN campaigns c ON c.id=j.campaign_id WHERE j.status='queued' AND c.status='sending' AND j.available_at<=? ORDER BY j.available_at,j.rowid LIMIT 1",
      now,
    );
    if (!job) return;
    execute(
      "UPDATE jobs SET status='processing',attempts=attempts+1,started_at=?,error=NULL WHERE id=?",
      now,
      job.id,
    );
    execute("UPDATE settings SET last_send=? WHERE id=1", now);
    execute("INSERT INTO send_attempts(created_at) VALUES(?)", now);
    return { ...job, status: "processing", attempts: job.attempts + 1 };
  });
}
export async function deliver(job: LocalJob) {
  let sending = false;
  try {
    const c = getCampaign(job.campaign_id),
      sender = getSender();
    if (!sender) throw new Error("Sender missing.");
    const recipient = c.recipients.find((r) => r.id === job.recipient_id);
    if (!recipient || recipient.excluded) throw new Error("Recipient missing.");
    if (!recipient.certificates.length) throw new Error("Recipient missing.");
    const attachments = recipient.certificates.map((id) => {
      const cert = getCertificate(id, c.id);
      return {
        filename: cert.name,
        content: readFileSync(certificatePath(cert.id)),
        contentType: "application/pdf",
      };
    });
    const smtp = await transport(sender);
    try {
      sending = true;
      const result = await smtp.sendMail({
        from: { name: sender.sender_name, address: sender.email },
        to: recipient.email.trim(),
        subject: personalize(c.subject, c, recipient.name),
        ...renderEmail(c, recipient.name),
        messageId: `<${job.id}@${sender.email.split("@")[1]}>`,
        attachments,
      });
      if (!result.accepted?.length)
        throw Object.assign(new Error("Message rejected"), {
          responseCode: 550,
        });
    } finally {
      smtp.close();
    }
    execute(
      "UPDATE jobs SET status='accepted',accepted_at=?,error=NULL WHERE id=?",
      new Date().toISOString(),
      job.id,
    );
  } catch (e) {
    const code = (e as { responseCode?: number }).responseCode;
    const transient = !!code && code >= 400 && code < 500;
    const uncertain = sending && !code;
    const status = uncertain
      ? "uncertain"
      : transient && job.attempts < 3
        ? "queued"
        : "failed";
    const error = uncertain
      ? "SMTP outcome unknown. Check sent-mail records before any resend."
      : code
        ? `SMTP ${code}. ${transient ? "Temporary provider rejection." : "Provider rejected the message."}`
        : `Could not prepare email${e instanceof Error && e.message ? ` (${e.message.slice(0, 160)})` : ""}. Check local certificate files and sender configuration.`;
    execute(
      "UPDATE jobs SET status=?,error=?,available_at=? WHERE id=?",
      status,
      error,
      Date.now() + 2 ** job.attempts * 60000,
      job.id,
    );
  }
}
export function finishCampaigns() {
  execute(
    "UPDATE campaigns SET status='complete' WHERE status='sending' AND NOT EXISTS(SELECT 1 FROM jobs WHERE jobs.campaign_id=campaigns.id AND jobs.status IN ('queued','processing'))",
  );
}
export function recoverInterrupted() {
  execute(
    "UPDATE jobs SET status='uncertain',error='Sending was interrupted. Check provider records before resending.' WHERE status='processing' AND started_at<?",
    Date.now() - 300000,
  );
}
export function cleanup() {
  for (const row of all<StoredCampaign>(
    "SELECT * FROM campaigns WHERE status IN ('draft','paused','complete','deleting')",
  )) {
    const c = parseCampaign(row);
    if (
      c.status === "deleting" ||
      Date.now() - new Date(c.created_at!).getTime() >
        c.retention_days * 86400000
    ) {
      if (
        !one(
          "SELECT id FROM jobs WHERE campaign_id=? AND status='processing'",
          c.id,
        )
      )
        deleteCampaign(c.id);
    }
  }
  execute(
    "DELETE FROM send_attempts WHERE created_at<?",
    Date.now() - 2 * 86400000,
  );
  execute(
    "DELETE FROM audit_logs WHERE created_at<?",
    new Date(Date.now() - 365 * 86400000).toISOString(),
  );
}
type Worker = {
  timer: ReturnType<typeof setInterval>;
  busy: boolean;
  lastCleanup: number;
};
const globalWorker = globalThis as typeof globalThis & {
  certifyWorker?: Worker;
};
export function startWorker() {
  if (globalWorker.certifyWorker) return;
  const state: Worker = {
    timer: null as unknown as ReturnType<typeof setInterval>,
    busy: false,
    lastCleanup: 0,
  };
  globalWorker.certifyWorker = state;
  const tick = async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      recoverInterrupted();
      if (Date.now() - state.lastCleanup > 3600000) {
        cleanup();
        state.lastCleanup = Date.now();
      }
      const job = claimNext();
      if (job) await deliver(job);
      finishCampaigns();
    } catch {
      console.error(
        "Local certificate worker could not complete its cycle. Check local data access and sender configuration.",
      );
    } finally {
      state.busy = false;
    }
  };
  state.timer = setInterval(tick, 2000);
  state.timer.unref();
  void tick();
}
