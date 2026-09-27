import QRCode from "qrcode";

/** PNG bytes (for pdf-lib embedPng) of the verification QR. */
export async function qrPngBytes(text: string): Promise<Uint8Array> {
  const url = await QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 480,
  });
  const res = await fetch(url);
  return new Uint8Array(await res.arrayBuffer());
}

/** Data URL for on-screen preview overlays. */
export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
  });
}
