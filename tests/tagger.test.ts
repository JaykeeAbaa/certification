import { describe, it, expect } from "vitest";
import {
  PDFDocument,
  StandardFonts,
  PDFRawStream,
  degrees,
  rgb,
} from "pdf-lib";
import {
  defaultTagStyle,
  defaultQrStyle,
  generateCertificate,
  inspectTemplate,
  certificateFilename,
  visualToPdf,
} from "../src/lib/certificate-tagger";
import { formatQrText } from "../src/lib/qr-verify";
import { qrPngBytes } from "../src/lib/qr-render";
import { mkdirSync, writeFileSync } from "node:fs";
async function fixture() {
  const d = await PDFDocument.create();
  const p = d.addPage([842, 595]);
  const font = await d.embedFont(StandardFonts.TimesRoman);
  p.drawRectangle({
    x: 25,
    y: 25,
    width: 792,
    height: 545,
    borderWidth: 2,
    borderColor: rgb(0.15, 0.3, 0.55),
  });
  p.drawText("CERTIFICATE OF COMPLETION", { x: 135, y: 440, size: 30, font });
  p.drawText("This certificate is proudly presented to", {
    x: 260,
    y: 355,
    size: 17,
    font,
  });
  p.drawLine({
    start: { x: 150, y: 285 },
    end: { x: 692, y: 285 },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });
  p.drawText("for completing Digital Literacy Training", {
    x: 260,
    y: 240,
    size: 17,
    font,
  });
  p.drawText("FICTIONAL DRAFT FOR SOFTWARE TESTING", {
    x: 285,
    y: 70,
    size: 11,
    font,
  });
  d.addPage([500, 700]).drawText("Original second page must remain unchanged.");
  return d.save();
}
describe("PDF certificate tagger", () => {
  it("isolates the movable name layer without adding pages to the download", async () => {
    const source = await PDFDocument.load(await fixture());
    source.getPage(0).setCropBox(20, 30, 780, 520);
    source.getPage(0).setRotation(degrees(90));
    const result = await generateCertificate(
      await source.save(),
      "Alex Santos",
      defaultTagStyle,
      undefined,
      true,
    );
    const output = await PDFDocument.load(result.bytes);
    const layer = await PDFDocument.load(result.nameLayer!);
    expect(output.getPageCount()).toBe(2);
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(layer.getPageCount()).toBe(1);
    expect(layer.getPage(0).getSize()).toEqual({ width: 520, height: 780 });
    expect(layer.getPage(0).getRotation().angle).toBe(0);
  });
  it("keeps original pages and content streams, adding vector text without rasterization", async () => {
    const original = await fixture();
    const before = await PDFDocument.load(original);
    const sourceStreams = before.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o) => o instanceof PDFRawStream)
      .map((o) =>
        Buffer.from((o as PDFRawStream).getContents()).toString("base64"),
      );
    const result = await generateCertificate(original, "Alex Santos", {
      ...defaultTagStyle,
      y: 50,
    });
    const after = await PDFDocument.load(result.bytes);
    expect(after.getPageCount()).toBe(2);
    expect(after.getPage(0).getSize()).toEqual(before.getPage(0).getSize());
    const outputStreams = after.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o) => o instanceof PDFRawStream)
      .map((o) =>
        Buffer.from((o as PDFRawStream).getContents()).toString("base64"),
      );
    sourceStreams.forEach((stream) => expect(outputStreams).toContain(stream));
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/tagger-draft.pdf", original);
    writeFileSync("test-results/tagger-preview.pdf", result.bytes);
  });
  it("preserves rotation, crop boxes and untouched pages", async () => {
    const d = await PDFDocument.load(await fixture());
    const p = d.getPage(0);
    p.setCropBox(20, 30, 780, 520);
    p.setRotation(degrees(90));
    const source = await d.save();
    const result = await generateCertificate(source, "Jamie Reyes", {
      ...defaultTagStyle,
      bold: false,
      italic: true,
      align: "right",
      x: 70,
    });
    const output = await PDFDocument.load(result.bytes);
    expect(output.getPage(0).getRotation().angle).toBe(90);
    expect(output.getPage(0).getCropBox()).toEqual(p.getCropBox());
    expect((await inspectTemplate(source))[0]).toEqual({
      width: 520,
      height: 780,
      rotation: 90,
    });
  });
  it("maps visible positions correctly for each right-angle rotation", () => {
    const box = { x: 10, y: 20, width: 800, height: 500 };
    expect(visualToPdf(100, 150, box, 0)).toEqual({ x: 110, y: 370 });
    expect(visualToPdf(100, 150, box, 90)).toEqual({ x: 160, y: 120 });
    expect(visualToPdf(100, 150, box, 180)).toEqual({ x: 710, y: 170 });
    expect(visualToPdf(100, 150, box, 270)).toEqual({ x: 660, y: 420 });
  });
  it("fits long names and rejects clipping when automatic fitting is disabled", async () => {
    const bytes = await fixture();
    const name = "Alexandra Maria Christina Santos Reyes";
    const result = await generateCertificate(bytes, name, {
      ...defaultTagStyle,
      width: 35,
      size: 48,
    });
    expect(result.actualSize).toBeLessThan(48);
    await expect(
      generateCertificate(bytes, name, {
        ...defaultTagStyle,
        width: 35,
        size: 48,
        fit: false,
      }),
    ).rejects.toThrow("wider");
    await expect(
      generateCertificate(bytes, "Alex", { ...defaultTagStyle, y: 0 }),
    ).rejects.toThrow("beyond");
  });
  it("reports unsupported characters instead of silently dropping glyphs", async () => {
    await expect(
      generateCertificate(await fixture(), "山田 太郎", defaultTagStyle),
    ).rejects.toThrow("cannot display");
  });
  it("names files after the CSV name, keeping duplicates and reserved names safe", () => {
    expect(certificateFilename("Alex Santos")).toBe("Alex Santos.pdf");
    expect(certificateFilename("Alex/Smith")).toBe("Alex_Smith.pdf");
    expect(certificateFilename("CON")).toBe("CON_.pdf");
    const taken = new Set<string>();
    expect(certificateFilename("Alex", taken)).toBe("Alex.pdf");
    expect(certificateFilename("Alex", taken)).toBe("Alex (2).pdf");
    expect(certificateFilename("ALEX", taken)).toBe("ALEX (3).pdf");
  });
  it("embeds the verification QR without adding pages", async () => {
    const details = {
      id: "DICTSDS-2026-09-001",
      name: "Alex Santos",
      training: "Digital Literacy Training",
      date: "2026-09-26",
      issuer: "DICT Caraga",
    };
    const png = await qrPngBytes(formatQrText(details));
    const result = await generateCertificate(await fixture(), details.name, defaultTagStyle, undefined, false, {
      png,
      style: { ...defaultQrStyle, enabled: true },
      captionText: details.id,
    });
    const output = await PDFDocument.load(result.bytes);
    expect(output.getPageCount()).toBe(2);
    await expect(
      generateCertificate(await fixture(), details.name, defaultTagStyle, undefined, false, {
        png,
        style: { ...defaultQrStyle, enabled: true, x: 2, size: 30 },
        captionText: details.id,
      }),
    ).rejects.toThrow("beyond the page");
  });
});
