import { z } from "zod";
import { readFileSync } from "node:fs";
import {
  localRequest,
  getCertificate,
  certificatePath,
  failure,
} from "@/lib/server";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    localRequest(req);
    const id = z.uuid().parse(new URL(req.url).searchParams.get("id"));
    const cert = getCertificate(id);
    return new Response(readFileSync(certificatePath(id)), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(cert.name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
