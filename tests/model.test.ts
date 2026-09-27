import { describe, it, expect } from "vitest";
import {
  matchCertificate,
  issues,
  newCampaign,
  renderEmail,
  safeUrl,
  csvCell,
  campaignSchema,
} from "../src/lib/model";
const files = [
  { id: "a", name: "José Santos.pdf", path: "a", size: 20 },
  { id: "b", name: "Jamie Reyes.pdf", path: "b", size: 20 },
];
describe("Certificate review", () => {
  it("matches normalized exact names and explicit filenames, never guesses", () => {
    expect(matchCertificate("Jose Santos", "", files)).toBe("a");
    expect(matchCertificate("Santos Jose", "", files)).toBeNull();
    expect(matchCertificate("Anything", "Jamie Reyes.pdf", files)).toBe("b");
    expect(matchCertificate("Jamie Reyes", "absent.pdf", files)).toBeNull();
  });
  it("requires manual review for ambiguous filenames", () => {
    expect(
      matchCertificate("Jose Santos", "", [...files, { ...files[0], id: "c" }]),
    ).toBeNull();
  });
  it("detects duplicate addresses, reused certificates, and missing matches", () => {
    const rows = [
      {
        id: "1",
        name: "Alex",
        email: "alex@example.com",
        certificate: "a",
        excluded: false,
      },
      {
        id: "2",
        name: "Other",
        email: "ALEX@example.com",
        certificate: "a",
        excluded: false,
      },
      { id: "3", name: "", email: "bad", certificate: null, excluded: false },
    ];
    expect(issues(rows).get("1")).toContain("Duplicate email");
    expect(issues(rows).get("2")).toContain("Certificate reused");
    expect(issues(rows).get("3")).toContain("Invalid email");
    rows[1].excluded = true;
    expect(issues(rows).get("1")).toBe("");
  });
});
describe("Safe email rendering", () => {
  it("escapes participant text and rejects executable links", () => {
    const c = newCampaign();
    c.design.blocks = [
      { id: "x", type: "text", text: "Hello {{name}}", url: "" },
      { id: "y", type: "button", text: "Click", url: "javascript:alert(1)" },
    ];
    const output = renderEmail(c, "<img onerror=alert(1)>");
    expect(output.html).toContain("&lt;img");
    expect(output.html).not.toContain("javascript:");
    expect(output.text).toContain("Hello <img");
    expect(safeUrl("http://example.com")).toBe("");
  });
  it("rejects subject header injection and invalid theme values", () => {
    const c = newCampaign();
    c.subject = "Hello\r\nBcc: attacker@example.com";
    expect(campaignSchema.safeParse(c).success).toBe(false);
    c.subject = "Certificate";
    c.design.color = "red;display:none";
    expect(campaignSchema.safeParse(c).success).toBe(false);
  });
  it("neutralizes spreadsheet formulas and quotes in exports", () => {
    expect(csvCell("=SUM(A1)")).toBe('"\'=SUM(A1)"');
    expect(csvCell('A "quote"')).toBe('"A ""quote"""');
  });
});
