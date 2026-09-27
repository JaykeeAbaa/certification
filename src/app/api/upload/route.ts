import { z } from "zod";
import { writeFileSync, rmSync } from "node:fs";
import {
  localRequest,
  getCampaign,
  all,
  execute,
  certificatePath,
  transaction,
  failure,
  json,
} from "@/lib/server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    localRequest(req);
    if (Number(req.headers.get("content-length") || 0) > 11 * 1024 * 1024)
      throw new Error("Upload a PDF under 10 MB.");
    const form = await req.formData();
    const campaignId = z.uuid().parse(form.get("campaignId"));
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size < 5 ||
      file.size > 10485760 ||
      !file.name.toLowerCase().endsWith(".pdf")
    )
      throw new Error("Upload a PDF under 10 MB.");
    const name = z
      .string()
      .min(5)
      .max(200)
      .refine((v) => !/[\\/\r\n]/.test(v))
      .parse(file.name);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("The selected file is not a PDF.");
    const id = crypto.randomUUID();
    transaction(() => {
      if (getCampaign(campaignId).status !== "draft")
        throw new Error("Only drafts accept uploads.");
      if (
        all("SELECT id FROM certificates WHERE campaign_id=?", campaignId)
          .length >= 2000
      )
        throw new Error("Maximum 2,000 certificates per campaign.");
      try {
        writeFileSync(certificatePath(id), bytes, { flag: "wx", mode: 0o600 });
        execute(
          "INSERT INTO certificates(id,campaign_id,name,size) VALUES(?,?,?,?)",
          id,
          campaignId,
          name,
          bytes.length,
        );
      } catch (e) {
        rmSync(certificatePath(id), { force: true });
        throw e;
      }
    });
    return json({
      certificate: {
        id,
        name,
        size: bytes.length,
        path: `/api/certificate?id=${id}`,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
