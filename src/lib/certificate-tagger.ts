import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  PDFName,
  PDFNumber,
  type PDFFont,
} from "pdf-lib";
export type TagStyle = {
  page: number;
  x: number;
  y: number;
  font: "Helvetica" | "Times" | "Courier" | "Custom";
  size: number;
  align: "left" | "center" | "right";
  bold: boolean;
  italic: boolean;
  color: string;
  width: number;
  fit: boolean;
};
export const defaultTagStyle: TagStyle = {
  page: 0,
  x: 50,
  y: 52,
  font: "Times",
  size: 32,
  align: "center",
  bold: true,
  italic: false,
  color: "#172b4d",
  width: 80,
  fit: true,
};
export type TemplatePage = { width: number; height: number; rotation: number };
export type QrStyle = {
  enabled: boolean;
  page: number;
  /** Center of the QR, percent of visual page width. */
  x: number;
  /** Center of the QR, percent from the visual top. */
  y: number;
  /** QR edge length, percent of visual page width (5–30). */
  size: number;
  /** Print the certificate ID as a caption under the QR. */
  caption: boolean;
};
export const defaultQrStyle: QrStyle = {
  enabled: false,
  page: 0,
  x: 50,
  y: 82,
  size: 14,
  caption: true,
};
export type QrOverlay = {
  png: Uint8Array;
  style: QrStyle;
  captionText: string;
};
export async function inspectTemplate(bytes: Uint8Array) {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new Error(
      "This PDF could not be opened. Choose an unencrypted draft PDF.",
    );
  }
  if (!doc.getPageCount()) throw new Error("The PDF has no pages.");
  return doc.getPages().map((page) => {
    const crop = page.getCropBox(),
      rotation = ((page.getRotation().angle % 360) + 360) % 360;
    return {
      width: rotation % 180 ? crop.height : crop.width,
      height: rotation % 180 ? crop.width : crop.height,
      rotation,
    };
  });
}
function standardFont(s: TagStyle) {
  const variant = s.bold ? (s.italic ? 3 : 1) : s.italic ? 2 : 0;
  return {
    Helvetica: [
      StandardFonts.Helvetica,
      StandardFonts.HelveticaBold,
      StandardFonts.HelveticaOblique,
      StandardFonts.HelveticaBoldOblique,
    ],
    Times: [
      StandardFonts.TimesRoman,
      StandardFonts.TimesRomanBold,
      StandardFonts.TimesRomanItalic,
      StandardFonts.TimesRomanBoldItalic,
    ],
    Courier: [
      StandardFonts.Courier,
      StandardFonts.CourierBold,
      StandardFonts.CourierOblique,
      StandardFonts.CourierBoldOblique,
    ],
  }[s.font as "Helvetica" | "Times" | "Courier"][variant];
}
export function visualToPdf(
  x: number,
  y: number,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number,
) {
  switch (rotation) {
    case 90:
      return { x: crop.x + y, y: crop.y + x };
    case 180:
      return { x: crop.x + crop.width - x, y: crop.y + y };
    case 270:
      return { x: crop.x + crop.width - y, y: crop.y + crop.height - x };
    default:
      return { x: crop.x + x, y: crop.y + crop.height - y };
  }
}
export async function generateCertificate(
  template: Uint8Array,
  name: string,
  style: TagStyle,
  customFont?: Uint8Array,
  includePreviewLayer = false,
  qr?: QrOverlay,
) {
  const text = name.trim();
  if (!text || text.length > 200 || /[\r\n\u0000-\u001f]/.test(text))
    throw new Error("Each name must be a single line of 1–200 characters.");
  if (
    !Number.isFinite(style.size) ||
    style.size < 6 ||
    style.size > 144 ||
    ![style.x, style.y, style.width].every(Number.isFinite) ||
    style.x < 0 ||
    style.x > 100 ||
    style.y < 0 ||
    style.y > 100 ||
    style.width < 1 ||
    style.width > 100 ||
    !/^#[0-9a-f]{6}$/i.test(style.color)
  )
    throw new Error("Check the font size, color, and position settings.");
  const doc = await PDFDocument.load(template, { updateMetadata: false });
  if (
    !Number.isInteger(style.page) ||
    style.page < 0 ||
    style.page >= doc.getPageCount()
  )
    throw new Error("Select a valid certificate page.");
  const page = doc.getPage(style.page),
    crop = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation))
    throw new Error("This PDF has an unsupported page rotation.");
  let font: PDFFont;
  if (style.font === "Custom") {
    if (!customFont)
      throw new Error("Pick a saved font or upload a TTF, OTF, or WOFF font to use custom fonts.");
    const { default: fontkit } = await import("@pdf-lib/fontkit");
    doc.registerFontkit(fontkit);
    try {
      font = await doc.embedFont(customFont, { subset: true });
    } catch {
      throw new Error(
        "This font could not be embedded. Choose a valid TTF, OTF, or WOFF font.",
      );
    }
  } else font = await doc.embedFont(standardFont(style));
  const supported = new Set(font.getCharacterSet());
  if ([...text].some((c) => !supported.has(c.codePointAt(0)!)))
    throw new Error(
      `The selected font cannot display every character in “${text}”. Pick a saved font that supports the name.`,
    );
  const unitObject = page.node.get(PDFName.of("UserUnit"));
  const unit = unitObject instanceof PDFNumber ? unitObject.asNumber() : 1;
  const width = rotation % 180 ? crop.height : crop.width,
    height = rotation % 180 ? crop.width : crop.height;
  const anchorX = (width * style.x) / 100,
    baseline = (height * style.y) / 100;
  const available = Math.min(
    (width * style.width) / 100,
    style.align === "left"
      ? width - anchorX
      : style.align === "right"
        ? anchorX
        : 2 * Math.min(anchorX, width - anchorX),
  );
  let size = style.size / unit;
  const natural = font.widthOfTextAtSize(text, size);
  if (natural > available) {
    if (!style.fit)
      throw new Error(
        `“${text}” is wider than the name area. Enable automatic fitting, reduce the font size, or widen the area.`,
      );
    size *= available / natural;
  }
  if (size * unit < 6)
    throw new Error(
      "The name area is too narrow. Widen it or move the name away from the page edge.",
    );
  const textWidth = font.widthOfTextAtSize(text, size),
    ascent = font.heightAtSize(size, { descender: false }),
    heightWithDescender = font.heightAtSize(size),
    descent = Math.max(0, heightWithDescender - ascent);
  if (baseline - ascent < 0 || baseline + descent > height)
    throw new Error(
      "The name extends beyond the page. Move it farther from the top or bottom edge.",
    );
  const startX =
    anchorX -
    (style.align === "center"
      ? textWidth / 2
      : style.align === "right"
        ? textWidth
        : 0);
  const point = visualToPdf(startX, baseline, crop, rotation);
  const color = style.color.slice(1);
  page.drawText(text, {
    ...point,
    font,
    size,
    rotate: degrees(rotation),
    color: rgb(
      parseInt(color.slice(0, 2), 16) / 255,
      parseInt(color.slice(2, 4), 16) / 255,
      parseInt(color.slice(4, 6), 16) / 255,
    ),
  });
  // Preserve all source pages/resources. Only append a vector text content stream.
  if (qr && qr.style.enabled) {
    const q = qr.style;
    if (
      ![q.x, q.y, q.size].every(Number.isFinite) ||
      q.size < 5 ||
      q.size > 30 ||
      q.x < 0 ||
      q.x > 100 ||
      q.y < 0 ||
      q.y > 100 ||
      !Number.isInteger(q.page) ||
      q.page < 0 ||
      q.page >= doc.getPageCount()
    )
      throw new Error("Check the QR code size and position settings.");
    if (q.page !== style.page)
      throw new Error("The QR code must sit on the same page as the name.");
    const edge = (width * q.size) / 100;
    const cx = (width * q.x) / 100,
      cyTop = (height * q.y) / 100;
    if (cx - edge / 2 < 0 || cx + edge / 2 > width || cyTop - edge / 2 < 0 || cyTop + edge / 2 > height)
      throw new Error("The QR code extends beyond the page. Move it inward or shrink it.");
    let qrImage;
    try {
      qrImage = await doc.embedPng(qr.png);
    } catch {
      throw new Error("The QR image could not be embedded. Try generating again.");
    }
    const center = visualToPdf(cx, cyTop, crop, rotation);
    page.drawImage(qrImage, {
      x: center.x - edge / 2,
      y: center.y - edge / 2,
      width: edge,
      height: edge,
    });
    if (q.caption && qr.captionText) {
      const captionFont = await doc.embedFont(StandardFonts.Helvetica);
      const captionSize = Math.max(6, edge * 0.11) / unit;
      const captionWidth = captionFont.widthOfTextAtSize(qr.captionText, captionSize);
      const captionX = cx - captionWidth / 2;
      const captionTop = cyTop + edge / 2 + captionSize * 0.9;
      if (captionTop + captionSize * 0.4 <= height && captionX >= 0 && captionX + captionWidth <= width) {
        const captionPoint = visualToPdf(captionX, captionTop, crop, rotation);
        page.drawText(qr.captionText, {
          ...captionPoint,
          font: captionFont,
          size: captionSize,
          rotate: degrees(rotation),
          color: rgb(0.23, 0.28, 0.35),
        });
      }
    }
  }
  const bytes = await doc.save();
  let nameLayer: Uint8Array | undefined;
  if (includePreviewLayer) {
    // A transparent, isolated text page lets the browser move the name without
    // regenerating or repainting the certificate artwork on every pointer move.
    const layer = doc.addPage([width, height]);
    layer.drawText(text, {
      x: startX,
      y: height - baseline,
      font,
      size,
      color: rgb(
        parseInt(color.slice(0, 2), 16) / 255,
        parseInt(color.slice(2, 4), 16) / 255,
        parseInt(color.slice(4, 6), 16) / 255,
      ),
    });
    while (doc.getPageCount() > 1) doc.removePage(0);
    nameLayer = await doc.save();
  }
  return {
    bytes,
    nameLayer,
    actualSize: Math.round(size * unit * 10) / 10,
  };
}
export function certificateFilename(name: string, taken?: Set<string>) {
  let base =
    name
      .trim()
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "Participant";
  // Windows reserves CON, PRN, AUX, NUL, COM1-9, LPT1-9 even with an extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base += "_";
  if (!taken) return `${base}.pdf`;
  let candidate = base,
    suffix = 1;
  while (taken.has(candidate.toLowerCase())) {
    suffix += 1;
    const tag = ` (${suffix})`;
    candidate = base.slice(0, Math.max(1, 100 - tag.length)) + tag;
  }
  taken.add(candidate.toLowerCase());
  return `${candidate}.pdf`;
}
