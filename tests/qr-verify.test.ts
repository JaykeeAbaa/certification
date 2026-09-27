import {
  describe,
  it,
  expect,
} from "vitest";
import {
  generateKeypair,
  signDetails,
  formatQrText,
  parseQrText,
  verifyQrText,
  newCertificateId,
  type VerificationDetails,
} from "../src/lib/qr-verify";

const details: VerificationDetails = {
  id: "DICTSDS-2026-09-001",
  name: "Alex Santos",
  training: "Digital Literacy Training",
  date: "2026-09-26",
  issuer: "DICT Caraga",
};

function legacySigned(d: VerificationDetails, secretKey: string): string {
  return `${formatQrText(d)}\nSig: ${signDetails(d, secretKey)}`;
}

describe("QR certificate verification text", () => {
  it("formats a readable statement with no signature line", () => {
    const text = formatQrText(details);
    expect(text).toContain("DICT CERTIFICATE VERIFICATION");
    expect(text).toContain("ID: DICTSDS-2026-09-001");
    expect(text).toContain("Issuer: DICT Caraga");
    expect(text).not.toContain("Sig:");
    const parsed = parseQrText(text);
    expect(parsed.details).toEqual(details);
    expect(parsed.signature).toBeNull();
  });

  it("still verifies legacy signed QRs and detects tampering", () => {
    const keys = generateKeypair();
    const text = legacySigned(details, keys.secretKey);
    expect(verifyQrText(text, keys.publicKey)).toEqual({ valid: true, details });
    const tampered = text.replace("Alex Santos", "Jamie Reyes");
    expect(verifyQrText(tampered, keys.publicKey).valid).toBe(false);
    const other = generateKeypair();
    expect(verifyQrText(text, other.publicKey).valid).toBe(false);
  });

  it("rejects foreign QR content and bad fields", () => {
    const keys = generateKeypair();
    expect(() => parseQrText("hello world")).toThrow("not issued");
    expect(() => parseQrText(formatQrText({ ...details, date: "not-a-date" }))).toThrow();
    expect(() => verifyQrText(formatQrText(details), keys.publicKey)).toThrow("no signature");
    expect(() =>
      formatQrText({ ...details, training: "x".repeat(2000) }),
    ).toThrow("too long");
  });

  it("generates sequential IDs in DICTSDS-YEAR-MONTH-NNN order", () => {
    expect(newCertificateId("DICTSDS", "2026-09-26", 1)).toBe("DICTSDS-2026-09-001");
    expect(newCertificateId("DICTSDS", "2026-09-26", 2)).toBe("DICTSDS-2026-09-002");
    expect(newCertificateId("DICTSDS", "2026-09-26", 134)).toBe("DICTSDS-2026-09-134");
    expect(newCertificateId("caraga!", "2026-01-05", 9)).toBe("CARAGA-2026-01-009");
    for (const id of [
      newCertificateId("DICTSDS", "2026-09-26", 1),
      newCertificateId("DICTSDS", "2026-09-26", 2),
    ]) {
      expect(id).toMatch(/^[A-Z0-9]+-\d{4}-\d{2}-\d{3}$/);
    }
  });
});
