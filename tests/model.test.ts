import { describe, it, expect } from "vitest";
import {
  matchCertificate,
  matchCertificates,
  syncCertificates,
  issues,
  newCampaign,
  renderEmail,
  personalize,
  trainingDates,
  richText,
  plainText,
  escapeHtml,
  safeUrl,
  csvCell,
  campaignSchema,
  recipientSchema,
  designSchema,
} from "../src/lib/model";
import { emailPresets } from "../src/lib/presets";
const files = [
  { id: "a", name: "José Santos.pdf", path: "a", size: 20 },
  { id: "b", name: "Jamie Reyes.pdf", path: "b", size: 20 },
];
describe("Certificate review", () => {
  it("matches regardless of word order and ignores (signed) filename noise", () => {
    expect(matchCertificate("Jose Santos", "", files)).toBe("a");
    expect(matchCertificate("Santos Jose", "", files)).toBe("a");
    expect(matchCertificate("JOSE SANTOS", "", files)).toBe("a");
    expect(matchCertificate("Jose Santos", "", [...files, { ...files[0], id: "c", name: "Jose Santos(signed)(signed).pdf" }])).toBe("a");
    expect(matchCertificate("Charish C. Cajolo", "", [{ id: "x", name: "Charish C. Cajolo(signed)(signed).pdf", path: "x", size: 1 }])).toBe("x");
    expect(matchCertificate("CHARISH CAJOLO", "", [{ id: "x", name: "Charish C. Cajolo(signed)(signed).pdf", path: "x", size: 1 }])).toBe("x");
    expect(matchCertificate("Anything", "Jamie Reyes.pdf", files)).toBe("b");
    expect(matchCertificate("Jamie Reyes", "absent.pdf", files)).toBeNull();
    expect(matchCertificate("Nobody Here", "", files)).toBeNull();
  });
  it("auto-matches real uploaded filenames with (signed) markers", () => {
    const uploaded = [
      "Alexander Pasaylo Melindo(signed).pdf",
      "Brentcarl Castro Alib(signed)(signed).pdf",
      "Charish C. Cajolo(signed)(signed).pdf",
      "Charish Cajolo(signed)(signed).pdf",
      "Charity Grace Genobatin Oliva(signed).pdf",
      "Christian T. Coquilla(signed)(signed).pdf",
      "Everly Tapaya Mesias(signed)(signed).pdf",
      "Hazel Mae Basa Resullar(signed)(signed).pdf",
      "Jhunen Mae Curay(signed)(signed).pdf",
    ].map((name, i) => ({ id: `f${i}`, name, path: `f${i}`, size: 10 }));
    const names: Record<string, string[]> = {
      "Christian T. Coquilla": ["Christian T. Coquilla(signed)(signed).pdf"],
      "CHARISH CAJOLO": [
        "Charish Cajolo(signed)(signed).pdf",
        "Charish C. Cajolo(signed)(signed).pdf",
      ],
      "Brentcarl Castro Alib": ["Brentcarl Castro Alib(signed)(signed).pdf"],
      "Jhunen Mae Curay": ["Jhunen Mae Curay(signed)(signed).pdf"],
      "Hazel Mae Basa Resullar": ["Hazel Mae Basa Resullar(signed)(signed).pdf"],
      "Everly Tapaya Mesias": ["Everly Tapaya Mesias(signed)(signed).pdf"],
      "CHARITY GRACE GENOBATIN OLIVA": ["Charity Grace Genobatin Oliva(signed).pdf"],
      "ALEXANDER PASAYLO MELINDO": ["Alexander Pasaylo Melindo(signed).pdf"],
    };
    for (const [name, expected] of Object.entries(names)) {
      expect(matchCertificates(name, uploaded).map((f) => f.name).sort()).toEqual(
        [...expected].sort(),
      );
    }
    // Full sync: nobody left missing, no hand-matching needed.
    const recipients = Object.keys(names).map((name, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name,
      email: `p${i}@example.com`,
      certificates: [] as string[],
      excluded: false,
    }));
    const synced = syncCertificates(recipients, uploaded);
    expect(synced.every((r) => r.certificates.length > 0)).toBe(true);
    const problems = issues(synced);
    expect([...problems.values()].some((v) => v.includes("Certificate missing"))).toBe(false);
    // CHARISH CAJOLO gets both of her certificates.
    expect(synced[1].certificates).toHaveLength(2);
  });
  it("attaches every matching certificate, best match first", () => {
    const both = [
      { id: "x", name: "Charish C. Cajolo(signed)(signed).pdf", path: "x", size: 1 },
      { id: "y", name: "Charish Cajolo(signed)(signed).pdf", path: "y", size: 1 },
    ];
    expect(matchCertificates("CHARISH CAJOLO", both).map((f) => f.id)).toEqual(["y", "x"]);
    expect(matchCertificates("Nobody Here", both)).toEqual([]);
  });
  it("syncs matches automatically without clobbering manual choices", () => {
    const synced = syncCertificates(
      [
        { id: "11111111-1111-4111-8111-111111111111", name: "Jose Santos", email: "a@example.com", certificates: [], excluded: false },
        { id: "22222222-2222-4222-8222-222222222222", name: "Jamie Reyes", email: "b@example.com", certificates: ["b"], excluded: false },
      ],
      [...files, { id: "c", name: "Santos Jose(signed).pdf", path: "c", size: 1 }],
    );
    expect(synced[0].certificates).toEqual(["a", "c"]);
    expect(synced[1].certificates).toEqual(["b"]);
  });
  it("reads campaigns saved with a single certificate id", () => {
    const parsed = recipientSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Alex",
      email: "alex@example.com",
      certificate: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      excluded: false,
    });
    expect(parsed.certificates).toEqual(["aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"]);
  });
  it("detects duplicate addresses, reused certificates, and missing matches", () => {
    const rows = [
      {
        id: "1",
        name: "Alex",
        email: "alex@example.com",
        certificates: ["a"],
        excluded: false,
      },
      {
        id: "2",
        name: "Other",
        email: "ALEX@example.com",
        certificates: ["a", "b"],
        excluded: false,
      },
      { id: "3", name: "", email: "bad", certificates: [], excluded: false },
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
  it("supports multi-day training ranges and rejects reversed dates", () => {
    const c = newCampaign();
    expect(c.date_from).toBe(c.date_to);
    expect(trainingDates(c)).toBe(c.date_from);
    c.date_from = "2026-09-28";
    c.date_to = "2026-09-30";
    expect(trainingDates(c)).toBe("2026-09-28 to 2026-09-30");
    expect(personalize("Held {{training_date}}", c, "Alex")).toBe("Held 2026-09-28 to 2026-09-30");
    expect(campaignSchema.safeParse(c).success).toBe(true);
    c.date_to = "2026-09-27";
    expect(campaignSchema.safeParse(c).success).toBe(false);
    // Legacy single-date rows still render.
    expect(trainingDates({ date_from: "", date_to: "", date: "2026-09-26" })).toBe("2026-09-26");
  });
});
describe("Email rich text and presets", () => {
  it("renders **bold** and *italic* in HTML and strips them in text", () => {
    expect(richText(escapeHtml("Dear **Alex**, well *done*!"))).toBe(
      "Dear <strong>Alex</strong>, well <em>done</em>!",
    );
    expect(plainText("Dear **Alex**, well *done*!")).toBe("Dear Alex, well done!");
    // Unbalanced markers are left alone.
    expect(richText(escapeHtml("A * star and two"))).toBe("A * star and two");
    expect(richText(escapeHtml("A ** star"))).toBe("A ** star");
    // Markers never become executable HTML.
    expect(richText(escapeHtml("**<img>**"))).toBe("<strong>&lt;img&gt;</strong>");
  });
  it("formats participant names and titles inside email blocks", () => {
    const c = newCampaign();
    c.design.blocks = [
      { id: "x", type: "text", text: "Dear **{{name}}**, you finished *{{training_title}}*", url: "" },
    ];
    const output = renderEmail(c, "Alex Santos");
    expect(output.html).toContain("<strong>Alex Santos</strong>");
    expect(output.html).toContain("<em>");
    expect(output.text).toContain("Dear Alex Santos,");
    expect(output.text).not.toContain("**");
  });
  it("ships valid built-in presets", () => {
    expect(emailPresets.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(emailPresets.map((p) => p.id));
    expect(ids.size).toBe(emailPresets.length);
    for (const preset of emailPresets) {
      expect(designSchema.safeParse(preset.design).success).toBe(true);
      const c = { ...newCampaign(), design: preset.design };
      expect(campaignSchema.safeParse(c).success).toBe(true);
      expect(renderEmail(c, "Alex").html).toContain("<table");
    }
  });
});
