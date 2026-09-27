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
export const recipientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(200),
  email: z.string().max(254),
  certificate: z.string().uuid().nullable(),
  excluded: z.boolean().default(false),
});
export const campaignSchema = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.string().max(30),
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
  return {
    id: crypto.randomUUID(),
    title: "Untitled training",
    date: new Date().toISOString().slice(0, 10),
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
export function validEmail(value: string) {
  return z.email().safeParse(value.trim()).success;
}
export function matchCertificate(
  name: string,
  filename: string,
  files: Certificate[],
) {
  if (!filename && !normalize(name)) return null;
  const matches = files.filter((f) =>
    filename
      ? f.name.toLowerCase() === filename.trim().toLowerCase()
      : normalize(f.name) === normalize(name),
  );
  return matches.length === 1 ? matches[0].id : null;
}
export function issues(recipients: Recipient[]) {
  const active = recipients.filter((r) => !r.excluded);
  return new Map(
    active.map((r) => [
      r.id,
      [
        !r.name.trim() && "Name missing",
        !validEmail(r.email) && "Invalid email",
        active.filter(
          (x) => x.email.trim().toLowerCase() === r.email.trim().toLowerCase(),
        ).length > 1 && "Duplicate email",
        !r.certificate && "Certificate missing",
        r.certificate &&
          active.filter((x) => x.certificate === r.certificate).length > 1 &&
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
export function personalize(
  s: string,
  c: Pick<Campaign, "title" | "date" | "organizer">,
  name: string,
) {
  return s.replace(
    /\{\{(name|training_title|training_date|organizer)\}\}/g,
    (_, key: string) =>
      ({
        name,
        training_title: c.title,
        training_date: c.date,
        organizer: c.organizer,
      })[key]!,
  );
}
export function renderEmail(
  c: Pick<Campaign, "title" | "date" | "organizer" | "preheader" | "design">,
  name: string,
) {
  const d = c.design;
  const html = d.blocks
    .map((b) => {
      const text = escapeHtml(personalize(b.text, c, name)).replace(
        /\n/g,
        "<br>",
      );
      const url = escapeHtml(safeUrl(b.url));
      if (b.type === "divider")
        return '<tr><td style="padding:14px 0"><hr style="border:0;border-top:1px solid #dce2eb"></td></tr>';
      if (b.type === "image")
        return url
          ? `<tr><td style="padding:12px 0"><img src="${url}" alt="${text}" width="220" style="max-width:100%;height:auto"></td></tr>`
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
          personalize(b.text, c, name) +
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
