import { z } from "zod";
export const blockSchema = z.object({
  id: z.string(),
  type: z.enum(["heading", "text", "button", "image", "divider"]),
  text: z.string().max(5000),
  url: z.string().max(2000).default(""),
});
export const designSchema = z.object({
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  background: z.string().regex(/^#[0-9a-f]{6}$/i),
  font: z.enum(["Arial", "Georgia", "Verdana", "Trebuchet MS"]),
  align: z.enum(["left", "center"]),
  spacing: z.number().min(12).max(48),
  blocks: z.array(blockSchema).max(30),
});
export const recipientSchema = z.preprocess(
  (v) => {
    // Campaigns saved before multi-certificate support hold a single `certificate` id.
    const r = v as Record<string, unknown>;
    if (r && !Array.isArray(r.certificates) && typeof r.certificate === "string") {
      const { certificate: _, ...rest } = r;
      return { ...rest, certificates: [r.certificate] };
    }
    return v;
  },
  z.object({
    id: z.string().uuid(),
    name: z.string().trim().max(200),
    email: z.string().max(254),
    certificates: z.array(z.string().uuid()).max(10).default([]),
    excluded: z.boolean().default(false),
  }),
);
export const campaignSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD."),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD."),
    organizer: z.string().trim().min(1).max(200),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((v) => !/[\r\n]/.test(v)),
  preheader: z.string().max(300),
  design: designSchema,
  recipients: z
    .array(recipientSchema)
    .max(2000)
    .refine(
      (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
      "Recipient IDs must be unique.",
    ),
  retention_days: z.number().int().min(7).max(365),
}).refine((c) => c.date_to >= c.date_from, {
  message: "End date cannot be before the start date.",
  path: ["date_to"],
});
export type Design = z.infer<typeof designSchema>;
export type Recipient = z.infer<typeof recipientSchema>;
export type Campaign = z.infer<typeof campaignSchema> & {
  id: string;
  status: string;
  created_at?: string;
};
export type Certificate = {
  id: string;
  name: string;
  path: string;
  size: number;
};
export type Job = {
  id: string;
  recipient_id: string;
  status: string;
  attempts: number;
  error: string | null;
  accepted_at: string | null;
};
export const defaultDesign: Design = {
  color: "#164dce",
  background: "#ffffff",
  font: "Arial",
  align: "left",
  spacing: 32,
  blocks: [
    {
      id: "1",
      type: "heading",
      text: "A new milestone. Well earned.",
      url: "",
    },
    {
      id: "2",
      type: "text",
      text: "Dear {{name}},\n\nCongratulations on completing {{training_title}}! Thank you for learning with us and taking another step toward a digitally empowered Philippines.\n\nYour signed certificate is attached to this email.",
      url: "",
    },
    {
      id: "3",
      type: "button",
      text: "Explore more opportunities",
      url: "https://dict.gov.ph",
    },
    { id: "4", type: "divider", text: "", url: "" },
    {
      id: "5",
      type: "text",
      text: "With appreciation,\n{{organizer}}\nDepartment of Information and Communications Technology",
      url: "",
    },
  ],
};
export function newCampaign(): Campaign {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: crypto.randomUUID(),
    title: "Untitled training",
    date_from: today,
    date_to: today,
    organizer: "DICT Caraga",
    subject: "Your certificate for {{training_title}}",
    preheader: "Thank you for learning with DICT. Your certificate is here.",
    design: structuredClone(defaultDesign),
    recipients: [],
    retention_days: 90,
    status: "draft",
  };
}
export function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]/g, "");
}
/** Tokens that carry no identity in uploaded filenames (e.g. "Name(signed)(signed).pdf"). */
const FILENAME_NOISE = new Set(["signed"]);
export function fileTokens(filename: string): string[] {
  return filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t && !FILENAME_NOISE.has(t));
}
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
}
function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length || !a.length) return false;
  const count = new Map<string, number>();
  for (const t of a) count.set(t, (count.get(t) || 0) + 1);
  for (const t of b) {
    const n = (count.get(t) || 0) - 1;
    if (n < 0) return false;
    count.set(t, n);
  }
  return true;
}
function firstLastKey(tokens: string[]): string {
  const words = tokens.filter((t) => !/^(jr|sr|ii|iii|iv|v)$/.test(t));
  if (!words.length) return "";
  if (words.length === 1) return words[0];
  return `${words[0]} ${words[words.length - 1]}`;
}
/**
 * Every uploaded certificate that could belong to `name`, best first:
 * exact token-set match (any word order), then first+last-name match
 * (middle names and initials ignored). Filename noise like "(signed)"
 * never blocks a match.
 */
export function matchCertificates(
  name: string,
  files: Certificate[],
): Certificate[] {
  const tokens = nameTokens(name);
  if (!tokens.length) return [];
  const scored: { file: Certificate; rank: number }[] = [];
  for (const file of files) {
    const ft = fileTokens(file.name);
    if (!ft.length) continue;
    if (sameMultiset(tokens, ft)) scored.push({ file, rank: 0 });
    else {
      const nk = firstLastKey(tokens),
        fk = firstLastKey(ft);
      if (nk && nk === fk) scored.push({ file, rank: 1 });
    }
  }
  return scored
    .sort((a, b) => a.rank - b.rank)
    .map((s) => s.file);
}
export function validEmail(value: string) {
  return z.email().safeParse(value.trim()).success;
}
export function matchCertificate(
  name: string,
  filename: string,
  files: Certificate[],
) {
  if (filename) {
    const match = files.find(
      (f) => f.name.toLowerCase() === filename.trim().toLowerCase(),
    );
    return match ? match.id : null;
  }
  if (!normalize(name)) return null;
  const smart = matchCertificates(name, files);
  return smart.length ? smart[0].id : null;
}
/** Attach every smart match; used when syncing after imports and uploads. */
export function syncCertificates(
  recipients: Recipient[],
  files: Certificate[],
): Recipient[] {
  return recipients.map((r) =>
    r.certificates.length
      ? r
      : {
          ...r,
          certificates: matchCertificates(r.name, files).map((f) => f.id),
        },
  );
}
export function issues(recipients: Recipient[]) {
  const active = recipients.filter((r) => !r.excluded);
  const usage = new Map<string, number>();
  for (const r of active)
    for (const id of r.certificates) usage.set(id, (usage.get(id) || 0) + 1);
  return new Map(
    active.map((r) => [
      r.id,
      [
        !r.name.trim() && "Name missing",
        !validEmail(r.email) && "Invalid email",
        active.filter(
          (x) => x.email.trim().toLowerCase() === r.email.trim().toLowerCase(),
        ).length > 1 && "Duplicate email",
        !r.certificates.length && "Certificate missing",
        r.certificates.some((id) => (usage.get(id) || 0) > 1) &&
          "Certificate reused",
      ]
        .filter(Boolean)
        .join(" · "),
    ]),
  );
}
export function safeUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}
export function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
/**
 * Minimal rich text for email blocks. Runs on already-escaped text:
 * `**bold**` becomes <strong>, `*italic*` becomes <em>.
 * Unbalanced markers are left untouched.
 */
export function richText(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}
/** Plain-text counterpart: markers are removed, never interpreted. */
export function plainText(personalized: string): string {
  return personalized.replace(/\*\*/g, "").replace(/(^|[^*])\*([^*]+)\*/g, "$1$2");
}
/** Display string for a training period. Falls back to legacy single `date` rows. */
export function trainingDates(
  c: Pick<Campaign, "date_from" | "date_to"> & { date?: string },
): string {
  const from = c.date_from || c.date || "";
  const to = c.date_to || c.date || from;
  if (!from) return to;
  if (!to || to === from) return from;
  return `${from} to ${to}`;
}
export function personalize(
  s: string,
  c: Pick<Campaign, "title" | "date_from" | "date_to" | "organizer"> & {
    date?: string;
  },
  name: string,
) {
  return s.replace(
    /\{\{(name|training_title|training_date|organizer)\}\}/g,
    (_, key: string) =>
      ({
        name,
        training_title: c.title,
        training_date: trainingDates(c),
        organizer: c.organizer,
      })[key]!,
  );
}
export function renderEmail(
  c: Pick<
    Campaign,
    "title" | "date_from" | "date_to" | "organizer" | "preheader" | "design"
  > & { date?: string },
  name: string,
) {
  const d = c.design;
  const html = d.blocks
    .map((b) => {
      const personalized = personalize(b.text, c, name);
      const text = richText(escapeHtml(personalized)).replace(/\n/g, "<br>");
      const alt = escapeHtml(personalized).replace(/\n/g, " ");
      const url = escapeHtml(safeUrl(b.url));
      if (b.type === "divider")
        return '<tr><td style="padding:14px 0"><hr style="border:0;border-top:1px solid #dce2eb"></td></tr>';
      if (b.type === "image")
        return url
          ? `<tr><td style="padding:12px 0"><img src="${url}" alt="${alt}" width="220" style="max-width:100%;height:auto"></td></tr>`
          : "";
      if (b.type === "button")
        return url
          ? `<tr><td style="padding:20px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table"><tr><td bgcolor="${d.color}" style="border-radius:6px;padding:14px 22px"><a href="${url}" style="color:white;font-weight:bold;text-decoration:none">${text}</a></td></tr></table></td></tr>`
          : "";
      return `<tr><td style="padding:10px 0;line-height:1.7;${b.type === "heading" ? "font-size:28px;font-weight:bold;line-height:1.25" : "font-size:16px"}">${text}</td></tr>`;
    })
    .join("");
  return {
    html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;padding:${d.spacing}px;background:#ffffff;font-family:'${d.font}',sans-serif;color:#202c43"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(c.preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;text-align:${d.align}">${html}</table></body></html>`,
    text: d.blocks
      .filter((b) => b.type !== "divider")
      .map(
        (b) =>
          plainText(personalize(b.text, c, name)) +
          (safeUrl(b.url) ? "\n" + safeUrl(b.url) : ""),
      )
      .join("\n\n"),
  };
}
export function csvCell(value: string) {
  return (
    '"' +
    (/^[=+\-@\t\r]/.test(value) ? "'" : "") +
    value.replace(/"/g, '""') +
    '"'
  );
}
