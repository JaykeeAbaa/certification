import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import JSZip from "jszip";
await mkdir("public/samples", { recursive: true });
const zip = new JSZip();
for (const name of ["Alex Santos", "Jamie Reyes"]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({
    x: 28,
    y: 28,
    width: 786,
    height: 539,
    borderWidth: 2,
    borderColor: rgb(0.08, 0.24, 0.52),
  });
  const center = (text, y, size, f = font) =>
    page.drawText(text, {
      x: (842 - f.widthOfTextAtSize(text, size)) / 2,
      y,
      size,
      font: f,
      color: rgb(0.08, 0.18, 0.32),
    });
  center("FICTIONAL SAMPLE - NOT AN OFFICIAL CERTIFICATE", 515, 12);
  center("CERTIFICATE OF COMPLETION", 420, 30, bold);
  center("Presented to", 355, 16);
  center(name, 295, 38, bold);
  center("for completing the sample Digital Literacy Training", 240, 17);
  center("Training date: September 25, 2026", 202, 14);
  center("Sample signature only / Training coordinator", 112, 14);
  center("Use this file to test matching and attachments.", 70, 11);
  const bytes = await doc.save();
  await writeFile(`public/samples/${name}.pdf`, bytes);
  zip.file(`${name}.pdf`, bytes);
}
await writeFile(
  "public/samples/certificates.zip",
  await zip.generateAsync({ type: "nodebuffer" }),
);
await writeFile(
  "public/samples/participants.csv",
  "name,email,certificate_filename\r\nAlex Santos,alex@example.com,Alex Santos.pdf\r\nJamie Reyes,jamie@example.com,Jamie Reyes.pdf\r\n",
);
await writeFile(
  "public/samples/validation-errors.csv",
  "name,email,certificate_filename\r\nAlex Santos,alex@example.com,Alex Santos.pdf\r\nAlex Duplicate,ALEX@example.com,Alex Santos.pdf\r\nJamie Reyes,invalid-email,Jamie Reyes.pdf\r\nMissing Person,missing@example.com,Not Uploaded.pdf\r\n",
);
console.log("Fictional sample PDFs, ZIP, and CSVs created.");
