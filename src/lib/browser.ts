export async function api(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Certify-Local": "1" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}
export async function uploadCertificate(campaignId: string, file: File) {
  const body = new FormData();
  body.set("campaignId", campaignId);
  body.set("file", file);
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "X-Certify-Local": "1" },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed.");
  return data.certificate;
}
