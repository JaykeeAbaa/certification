import { mkdir, copyFile, cp } from "node:fs/promises";
await mkdir("public/pdf-runtime", { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "public/pdf-runtime/pdf.worker.min.mjs",
);
for (const dir of ["standard_fonts", "cmaps", "wasm"])
  await cp(`node_modules/pdfjs-dist/${dir}`, `public/pdf-runtime/${dir}`, {
    recursive: true,
  });
console.log("Local PDF preview runtime installed.");
