import nacl from "tweetnacl";

export type VerificationDetails = {
  id: string;
  name: string;
  training: string;
  date: string;
  issuer: string;
};

const HEADER = "DICT CERTIFICATE VERIFICATION";
const MAX_QR_CHARS = 1500;

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateKeypair(): { publicKey: string; secretKey: string } {
  const kp = nacl.sign.keyPair();
  return { publicKey: b64encode(kp.publicKey), secretKey: b64encode(kp.secretKey) };
}

/** Canonical bytes that get signed. JSON with fixed key order avoids delimiter issues. */
export function canonicalBytes(d: VerificationDetails): Uint8Array {
  return new TextEncoder().encode(
    `DCTV1\n${JSON.stringify({ v: 1, id: d.id, name: d.name, training: d.training, date: d.date, issuer: d.issuer })}`,
  );
}

export function validateDetails(d: VerificationDetails): void {
  const fail = (m: string): never => {
    throw new Error(m);
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/.test(d.id))
    fail("Certificate ID must be 1–40 characters: letters, digits, dashes.");
  const single = (v: string, label: string, max: number) => {
    if (!v.trim() || v.length > max || /[\r\n\u0000-\u001f|]/.test(v))
      fail(`${label} must be a single line of 1–${max} characters (no | character).`);
  };
  single(d.name, "Participant name", 200);
  single(d.training, "Training title", 150);
  single(d.issuer, "Issuer", 120);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || Number.isNaN(new Date(d.date + "T00:00:00").getTime()))
    fail("Training date must be a real calendar date (YYYY-MM-DD).");
}

export function signDetails(d: VerificationDetails, secretKeyB64: string): string {
  validateDetails(d);
  let secret: Uint8Array;
  try {
    secret = b64decode(secretKeyB64);
  } catch {
    throw new Error("The signing key is corrupted. Restore it from backup or rotate keys.");
  }
  if (secret.length !== 64)
    throw new Error("The signing key is corrupted. Restore it from backup or rotate keys.");
  return b64encode(nacl.sign.detached(canonicalBytes(d), secret));
}

/** Human-readable verification statement. This exact text goes inside the QR code. */
export function formatQrText(d: VerificationDetails): string {
  const text =
    `${HEADER}\n` +
    `ID: ${d.id}\n` +
    `Name: ${d.name}\n` +
    `Training: ${d.training}\n` +
    `Date: ${d.date}\n` +
    `Issuer: ${d.issuer}`;
  if (text.length > MAX_QR_CHARS)
    throw new Error("Verification details are too long to fit a scannable QR code.");
  return text;
}

function field(lines: string[], label: string): string {
  const line = lines.find((l) => l.startsWith(label + ":"));
  if (!line) throw new Error(`QR text is missing the “${label}” line.`);
  const value = line.slice(label.length + 1).trim();
  if (!value) throw new Error(`QR text has an empty “${label}” value.`);
  return value;
}

export function parseQrText(text: string): { details: VerificationDetails; signature: string | null } {
  const lines = text.trim().split("\n").map((l) => l.trim());
  if (lines[0] !== HEADER)
    throw new Error("This QR code was not issued by this certificate system.");
  const details: VerificationDetails = {
    id: field(lines, "ID"),
    name: field(lines, "Name"),
    training: field(lines, "Training"),
    date: field(lines, "Date"),
    issuer: field(lines, "Issuer"),
  };
  // Legacy signed QRs (issued before the Sig line was removed) carry a Sig line.
  const sigLine = lines.find((l) => l.startsWith("Sig:"));
  const signature = sigLine ? sigLine.slice(4).trim() || null : null;
  validateDetails(details);
  return { details, signature };
}

export function verifyQrText(
  text: string,
  publicKeyB64: string,
): { valid: boolean; details: VerificationDetails } {
  const { details, signature } = parseQrText(text);
  if (!signature)
    throw new Error("This QR code carries no signature, so there is nothing to check. Compare its ID against the official participant list.");
  let publicKey: Uint8Array, sig: Uint8Array;
  try {
    publicKey = b64decode(publicKeyB64);
    sig = b64decode(signature);
  } catch {
    throw new Error("The public key or signature is not valid base64.");
  }
  if (publicKey.length !== 32 || sig.length !== 64)
    throw new Error("The public key or signature has the wrong length.");
  const valid = nacl.sign.detached.verify(canonicalBytes(details), sig, publicKey);
  return { valid, details };
}

/** Sequential per-batch certificate ID, e.g. DICTSDS-2026-09-001.
 * Year and month come from the issuance (training) date; seq starts at 1. */
export function newCertificateId(prefix = "DICTSDS", date = "", seq = 1): string {
  const clean = (prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "DICTSDS").slice(0, 12);
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  const year = match ? match[1] : String(new Date().getFullYear());
  const month = match ? match[2] : String(new Date().getMonth() + 1).padStart(2, "0");
  return `${clean}-${year}-${month}-${String(Math.max(1, seq)).padStart(3, "0")}`;
}
