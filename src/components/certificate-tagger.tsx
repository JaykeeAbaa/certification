"use client";
import { useEffect, useRef, useState } from "react";
import {
  Upload,
  FileText,
  Users,
  Download,
  MousePointer2,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Loader2,
  Bold,
  Italic,
  ZoomIn,
  ZoomOut,
  CheckCircle2,
  Trash2,
  Type,
  QrCode,
  X,
} from "lucide-react";
import Papa from "papaparse";
import JSZip from "jszip";
import {
  defaultTagStyle,
  defaultQrStyle,
  generateCertificate,
  inspectTemplate,
  certificateFilename,
  type TagStyle,
  type QrStyle,
  type TemplatePage,
} from "@/lib/certificate-tagger";
import {
  formatQrText,
  newCertificateId,
  type VerificationDetails,
} from "@/lib/qr-verify";
import { qrPngBytes, qrDataUrl } from "@/lib/qr-render";
import {
  deleteSavedFont,
  getLastUsedFontId,
  getSavedFont,
  listSavedFonts,
  saveFontFile,
  setLastUsedFontId,
  type SavedFontMeta,
} from "@/lib/saved-fonts";
import { csvCell } from "@/lib/model";
type Position = { x: number; y: number };
type Person = { name: string; email: string; certId: string };
function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export default function CertificateTagger() {
  const [template, setTemplate] = useState<Uint8Array | null>(null),
    [filename, setFilename] = useState(""),
    [pages, setPages] = useState<TemplatePage[]>([]),
    [style, setStyle] = useState<TagStyle>(defaultTagStyle),
    [customFont, setCustomFont] = useState<Uint8Array>(),
    [savedFonts, setSavedFonts] = useState<SavedFontMeta[]>([]),
    [activeFontId, setActiveFontId] = useState(""),
    [fontsLoading, setFontsLoading] = useState(true),
    [rows, setRows] = useState<Record<string, string>[]>([]),
    [columns, setColumns] = useState({ name: "", email: "" }),
    [people, setPeople] = useState<Person[]>([]),
    [selected, setSelected] = useState(0),
    [sample, setSample] = useState("Participant Name"),
    [preview, setPreview] = useState<Uint8Array | null>(null),
    [layer, setLayer] = useState<{
      bytes: Uint8Array;
      position: Position;
    } | null>(null),
    [actualSize, setActualSize] = useState(32),
    [busy, setBusy] = useState(""),
    [previewBusy, setPreviewBusy] = useState(false),
    // Only show the "updating" pill when rendering actually stalls; fast
    // regenerations (typing, dragging) stay flicker-free.
    [slowPreview, setSlowPreview] = useState(false),
    [error, setError] = useState(""),
    [previewError, setPreviewError] = useState(""),
    [notice, setNotice] = useState(""),
    [zoom, setZoom] = useState(100),
    [pageRatio, setPageRatio] = useState(1.414),
    [progress, setProgress] = useState(0),
    [training, setTraining] = useState({
      title: "",
      date: new Date().toISOString().slice(0, 10),
      issuer: "DICT SDS PO",
      prefix: "DICTSDS",
    }),
    [qrStyle, setQrStyle] = useState<QrStyle>(defaultQrStyle),
    [qrImg, setQrImg] = useState(""),
    [placeTarget, setPlaceTarget] = useState<"name" | "qr">("name");
  const pdfInput = useRef<HTMLInputElement>(null),
    csvInput = useRef<HTMLInputElement>(null),
    fontInput = useRef<HTMLInputElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    nameCanvas = useRef<HTMLCanvasElement>(null),
    anchor = useRef<HTMLSpanElement>(null),
    qrImgRef = useRef<HTMLImageElement>(null),
    renderedPosition = useRef<Position>({ x: 50, y: 52 }),
    drag = useRef<{
      id: number;
      kind: "name" | "qr";
      startX: number;
      startY: number;
      origin: Position;
      current: Position;
      rect: DOMRect;
    } | null>(null),
    cancel = useRef(false),
    generation = useRef(0);
  const name = people[selected]?.name || sample;
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete this operation.",
      );
    } finally {
      setBusy("");
    }
  }
  async function loadTemplate(file?: File) {
    if (!file) return;
    await run("Opening certificate template", async () => {
      if (
        !file.name.toLowerCase().endsWith(".pdf") ||
        file.size > 25 * 1024 * 1024
      )
        throw new Error("Choose a PDF template under 25 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = await inspectTemplate(bytes);
      setPages(info);
      setTemplate(bytes);
      setFilename(file.name);
      // Keep the user's current style (font, size, position) when swapping
      // templates; only clamp the page back into range.
      setStyle((previous) => ({
        ...previous,
        page: Math.min(previous.page, Math.max(0, info.length - 1)),
      }));
      setZoom(100);
      setPreview(null);
      setNotice("Template loaded. Click on the certificate to place the name.");
    });
  }
  function loadCsv(file?: File) {
    if (!file) return;
    setError("");
    setNotice("");
    if (file.size > 2 * 1024 * 1024) {
      setError("Choose a CSV under 2 MB.");
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
      complete: (result) => {
        if (result.errors.length) {
          setError(result.errors[0].message);
          return;
        }
        if (!result.data.length || result.data.length > 500) {
          setError("Import between 1 and 500 names per batch.");
          return;
        }
        const fields = result.meta.fields || [];
        setRows(result.data);
        setColumns({
          name:
            fields.find((f) =>
              /^(name|full.?name|participant.?name)$/i.test(f),
            ) ||
            fields[0] ||
            "",
          email: fields.find((f) => /email/i.test(f)) || "",
        });
      },
    });
  }
  function importNames() {
    if (!columns.name) {
      setError("Choose the column that holds participant names.");
      return;
    }
    const idField =
      rows.length > 0
        ? Object.keys(rows[0]).find((f) => /^(cert(ificate)?[ ._-]?id|id)$/i.test(f))
        : undefined;
    const seen = new Set<string>();
    const imported = rows.map((r, i) => ({
      name: (r[columns.name] || "").trim(),
      email: columns.email ? (r[columns.email] || "").trim() : "",
      certId:
        (idField ? (r[idField] || "").trim() : "") ||
        newCertificateId(training.prefix, training.date, i + 1),
    }));
    const invalid = imported.findIndex(
      (p) =>
        !p.name || p.name.length > 200 || /[\r\n\u0000-\u001f]/.test(p.name),
    );
    if (invalid >= 0) {
      setError(
        `CSV row ${invalid + 2} needs a single-line name of 1–200 characters.`,
      );
      return;
    }
    let badId = -1;
    for (let i = 0; i < imported.length; i++) {
      const key = imported[i].certId.toLowerCase();
      if (
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/.test(imported[i].certId) ||
        seen.has(key)
      ) {
        badId = i;
        break;
      }
      seen.add(key);
    }
    if (badId >= 0) {
      setError(
        idField
          ? `CSV row ${badId + 2}: certificate IDs must be unique, 1–40 characters (letters, digits, dashes).`
          : "Generated certificate IDs collided. Import again.",
      );
      return;
    }
    setPeople(imported);
    setSelected(0);
    setRows([]);
    setError("");
    setNotice(
      `${imported.length} names imported. Preview each participant before downloading.`,
    );
  }
  // Load the persisted font library once; fonts survive reloads via IndexedDB.
  useEffect(() => {
    let stale = false;
    void (async () => {
      try {
        const fonts = await listSavedFonts();
        if (stale) return;
        setSavedFonts(fonts);
        const preferred = getLastUsedFontId();
        const pick =
          fonts.find((f) => f.id === preferred) || fonts[fonts.length - 1];
        if (pick) {
          setActiveFontId(pick.id);
          const full = await getSavedFont(pick.id);
          if (!stale && full) setCustomFont(full.data);
        }
      } catch {
        if (!stale) setError("Saved fonts could not be loaded from this browser.");
      } finally {
        if (!stale) setFontsLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, []);

  async function selectFont(id: string) {
    setActiveFontId(id);
    if (!id) {
      setCustomFont(undefined);
      return;
    }
    setLastUsedFontId(id);
    try {
      const full = await getSavedFont(id);
      if (!full) {
        setSavedFonts((list) => list.filter((f) => f.id !== id));
        setActiveFontId("");
        setCustomFont(undefined);
        setError("That saved font is no longer available. Upload it again.");
        return;
      }
      setCustomFont(full.data);
    } catch {
      setError("Could not load the selected font.");
    }
  }

  async function uploadFont(file?: File) {
    if (!file) return;
    await run("Saving font", async () => {
      const meta = await saveFontFile(file);
      setSavedFonts((list) => [...list.filter((f) => f.id !== meta.id), meta]);
      setActiveFontId(meta.id);
      const full = await getSavedFont(meta.id);
      setCustomFont(full?.data);
      setStyle((previous) => ({ ...previous, font: "Custom" }));
      setNotice(`Font “${meta.name}” saved in this browser.`);
    });
  }

  async function removeFont(id: string) {
    await deleteSavedFont(id);
    setSavedFonts((list) => list.filter((f) => f.id !== id));
    if (id === activeFontId) {
      setActiveFontId("");
      setCustomFont(undefined);
    }
  }
  function currentDetails(): VerificationDetails {
    const person = people[selected];
    return {
      id: person?.certId || "SAMPLE-001",
      name: person?.name || sample || "Participant Name",
      training: training.title.trim(),
      date: training.date,
      issuer: training.issuer.trim(),
    };
  }

  useEffect(() => {
    if (!previewBusy) {
      setSlowPreview(false);
      return;
    }
    const timer = setTimeout(() => setSlowPreview(true), 600);
    return () => clearTimeout(timer);
  }, [previewBusy]);

  useEffect(() => {
    if (!template) return;
    let stale = false;
    const current = ++generation.current;
    setPreview(null);
    setPreviewError("");
    setPreviewBusy(true);
    const timer = setTimeout(async () => {
      try {
        let overlay: { png: Uint8Array; style: QrStyle; captionText: string } | undefined;
        let overlayImg = "";
        if (qrStyle.enabled) {
          const details = currentDetails();
          const text = formatQrText(details);
          overlay = {
            png: await qrPngBytes(text),
            style: { ...qrStyle, page: style.page },
            captionText: details.id,
          };
          overlayImg = await qrDataUrl(text);
        }
        const result = await generateCertificate(
          template,
          name,
          style,
          customFont,
          true,
          overlay,
        );
        if (!stale && current === generation.current) {
          setPreview(result.bytes);
          setLayer({
            bytes: result.nameLayer!,
            position: { x: style.x, y: style.y },
          });
          setActualSize(result.actualSize);
          setQrImg(overlayImg);
        }
      } catch (e) {
        if (!stale) {
          setPreviewError(
            e instanceof Error ? e.message : "Could not render name.",
          );
          setPreview(template);
          setLayer(null);
          setQrImg("");
        }
      } finally {
        if (!stale) setPreviewBusy(false);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [template, name, style, customFont, qrStyle, training, selected, people, sample]);
  useEffect(() => {
    if (!template || !canvas.current) return;
    let stopped = false;
    let task: import("pdfjs-dist").RenderTask | undefined;
    let document: import("pdfjs-dist").PDFDocumentProxy | undefined;
    let loading: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;
    const target = canvas.current;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-runtime/pdf.worker.min.mjs";
        loading = pdfjs.getDocument({
          data: new Uint8Array(template),
          standardFontDataUrl: "/pdf-runtime/standard_fonts/",
          cMapUrl: "/pdf-runtime/cmaps/",
          cMapPacked: true,
          wasmUrl: "/pdf-runtime/wasm/",
        });
        document = await loading.promise;
        if (stopped) {
          return;
        }
        const page = await document.getPage(style.page + 1);
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(3, 1600 / natural.width),
        });
        if (stopped) return;
        const scratch = window.document.createElement("canvas");
        scratch.width = Math.ceil(viewport.width);
        scratch.height = Math.ceil(viewport.height);
        task = page.render({
          canvas: scratch,
          canvasContext: scratch.getContext("2d")!,
          viewport,
        });
        await task.promise;
        if (stopped) return;
        target.width = scratch.width;
        target.height = scratch.height;
        target.getContext("2d")!.drawImage(scratch, 0, 0);
        setPageRatio(natural.width / natural.height);
      } catch (e) {
        if (!stopped)
          setPreviewError(
            e instanceof Error ? e.message : "PDF preview failed.",
          );
      } finally {
        if (loading) await loading.destroy();
      }
    })();
    return () => {
      stopped = true;
      task?.cancel();
    };
  }, [template, style.page]);
  useEffect(() => {
    const target = nameCanvas.current;
    if (!target) return;
    if (!layer) {
      target.getContext("2d")?.clearRect(0, 0, target.width, target.height);
      target.style.transform = "";
      return;
    }
    let stopped = false;
    let task: import("pdfjs-dist").RenderTask | undefined;
    let loading: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-runtime/pdf.worker.min.mjs";
        loading = pdfjs.getDocument({
          data: new Uint8Array(layer.bytes),
          standardFontDataUrl: "/pdf-runtime/standard_fonts/",
          cMapUrl: "/pdf-runtime/cmaps/",
          cMapPacked: true,
          wasmUrl: "/pdf-runtime/wasm/",
        });
        const doc = await loading.promise;
        if (stopped) return;
        const page = await doc.getPage(1);
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(3, 1600 / natural.width),
        });
        const scratch = document.createElement("canvas");
        scratch.width = Math.ceil(viewport.width);
        scratch.height = Math.ceil(viewport.height);
        task = page.render({
          canvas: scratch,
          canvasContext: scratch.getContext("2d", { alpha: true })!,
          viewport,
          background: "rgba(0,0,0,0)",
        });
        await task.promise;
        if (stopped) return;
        target.width = scratch.width;
        target.height = scratch.height;
        target.getContext("2d")!.drawImage(scratch, 0, 0);
        renderedPosition.current = layer.position;
        const position = drag.current?.current || layer.position;
        moveName(position);
      } catch (e) {
        if (!stopped)
          setPreviewError(
            e instanceof Error ? e.message : "Name preview failed.",
          );
      } finally {
        await loading?.destroy();
      }
    })();
    return () => {
      stopped = true;
      task?.cancel();
    };
  }, [layer]);
  function moveName(position: Position) {
    if (nameCanvas.current)
      nameCanvas.current.style.transform = `translate3d(${position.x - renderedPosition.current.x}%, ${position.y - renderedPosition.current.y}%, 0)`;
    if (anchor.current) {
      anchor.current.style.left = `${position.x}%`;
      anchor.current.style.top = `${position.y}%`;
    }
  }
  function moveQr(position: Position) {
    const img = qrImgRef.current;
    if (img) {
      img.style.left = `${position.x}%`;
      img.style.top = `${position.y}%`;
    }
  }
  function movePointer(e: React.PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.id !== e.pointerId) return;
    active.current = {
      x: Math.max(
        0,
        Math.min(
          100,
          active.origin.x +
            ((e.clientX - active.startX) / active.rect.width) * 100,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          100,
          active.origin.y +
            ((e.clientY - active.startY) / active.rect.height) * 100,
        ),
      ),
    };
    if (active.kind === "qr") moveQr(active.current);
    else moveName(active.current);
  }
  function finishDrag(
    e: React.PointerEvent<HTMLDivElement>,
    cancelled = false,
  ) {
    const active = drag.current;
    if (!active || active.id !== e.pointerId) return;
    if (!cancelled) movePointer(e);
    drag.current = null;
    e.currentTarget.classList.remove("is-dragging");
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (active.kind === "qr") {
      const position = cancelled
        ? { x: qrStyle.x, y: qrStyle.y }
        : active.current;
      moveQr(position);
      if (!cancelled)
        setQrStyle((previous) => ({
          ...previous,
          x: Math.round(position.x * 10) / 10,
          y: Math.round(position.y * 10) / 10,
        }));
      return;
    }
    const position = cancelled ? { x: style.x, y: style.y } : active.current;
    moveName(position);
    if (!cancelled)
      update({
        x: Math.round(position.x * 10) / 10,
        y: Math.round(position.y * 10) / 10,
      });
  }
  function update(values: Partial<TagStyle>) {
    setStyle((previous) => ({ ...previous, ...values }));
  }
  async function exportZip() {
    if (!template || !people.length) return;
    cancel.current = false;
    setProgress(0);
    await run("Generating certificates", async () => {
      const zip = new JSZip();
      let total = 0;
      const manifest = [
        "name,email,certificate_filename,certificate_id,training_title,training_date,issuer",
      ];
      const usedNames = new Set<string>();
      const title = training.title.trim(),
        issuer = training.issuer.trim();
      for (let i = 0; i < people.length; i++) {
        if (cancel.current) {
          setNotice("Generation cancelled. No partial ZIP was downloaded.");
          return;
        }
        setBusy(`Generating certificate ${i + 1} of ${people.length}`);
        let bytes: Uint8Array;
        try {
          let overlay: { png: Uint8Array; style: QrStyle; captionText: string } | undefined;
          if (qrStyle.enabled) {
            const text = formatQrText(
              { id: people[i].certId, name: people[i].name, training: title, date: training.date, issuer },
            );
            overlay = {
              png: await qrPngBytes(text),
              style: { ...qrStyle, page: style.page },
              captionText: people[i].certId,
            };
          }
          bytes = (
            await generateCertificate(
              template,
              people[i].name,
              style,
              customFont,
              false,
              overlay,
            )
          ).bytes;
        } catch (e) {
          throw new Error(
            `Participant ${i + 1}: ${e instanceof Error ? e.message : "Could not generate certificate."}`,
          );
        }
        total += bytes.length;
        if (total > 250 * 1024 * 1024)
          throw new Error(
            "This batch exceeds 250 MB. Split the CSV into smaller batches.",
          );
        const file = certificateFilename(people[i].name, usedNames);
        zip.file(file, bytes);
        manifest.push(
          [people[i].name, people[i].email, file, people[i].certId, title, training.date, issuer]
            .map(csvCell)
            .join(","),
        );
        setProgress(Math.round(((i + 1) / people.length) * 100));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      zip.file("participants.csv", "\uFEFF" + manifest.join("\r\n"));
      setBusy("Preparing ZIP download");
      const bytes = await zip.generateAsync(
        { type: "uint8array", compression: "STORE" },
        () => {},
      );
      if (cancel.current) {
        setNotice("Generation cancelled.");
        return;
      }
      download(bytes, "personalized-certificates.zip", "application/zip");
      setNotice(
        `${people.length} certificates downloaded with a matching participant CSV.`,
      );
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONE TEMPLATE. EVERY PARTICIPANT.</div>
          <h1>Certificate tagger</h1>
          <p>
            Place a name once. Personalize every certificate with the original
            PDF quality.
          </p>
        </div>
        <button
          className="primary"
          disabled={!!busy || previewBusy || !template || !people.length}
          title={
            previewError
              ? `Preview warning: ${previewError}. Download will retry each certificate.`
              : undefined
          }
          onClick={exportZip}
        >
          <Download size={17} />
          Download all {people.length > 0 ? `(${people.length})` : ""}
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {busy && (
        <div className="tag-progress" role="status">
          <Loader2 size={17} className="spin" />
          {busy}
          {busy.startsWith("Generating") && (
            <>
              <progress value={progress} max={100} />
              <button
                className="text-button"
                onClick={() => (cancel.current = true)}
              >
                Cancel batch
              </button>
            </>
          )}
        </div>
      )}
      <div className="tagger-layout">
        <aside className="panel tagger-controls">
          <fieldset disabled={!!busy}>
            <h2>1. Add your files</h2>
            <input
              ref={pdfInput}
              hidden
              type="file"
              accept=".pdf"
              onChange={(e) => {
                void loadTemplate(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              className="secondary wide"
              onClick={() => pdfInput.current?.click()}
            >
              <FileText size={16} />
              {template ? "Replace PDF template" : "Upload PDF template"}
            </button>
            {filename && (
              <div className="tag-file-meta">
                <FileText size={13} />
                <span title={filename}>
                  {filename} · {pages.length} page{pages.length === 1 ? "" : "s"}
                </span>
              </div>
            )}
            <input
              ref={csvInput}
              hidden
              type="file"
              accept=".csv"
              onChange={(e) => {
                loadCsv(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              className="secondary wide"
              onClick={() => csvInput.current?.click()}
            >
              <Users size={16} />
              Upload names CSV
            </button>
            <div className="tag-csv-row">
              <button
                className="text-button"
                onClick={() =>
                  download(
                    new TextEncoder().encode(
                      "name,email\r\nAlex Santos,alex@example.com\r\nJamie Reyes,jamie@example.com\r\n",
                    ),
                    "certificate-names.csv",
                    "text/csv",
                  )
                }
              >
                <Download size={14} />
                CSV example
              </button>
              {people.length > 0 && (
                <span className="tag-people-badge">
                  <CheckCircle2 size={13} />
                  {people.length} names ready
                </span>
              )}
            </div>
            {rows.length > 0 && (
              <div className="tag-mapping">
                <label>
                  Name column
                  <select
                    value={columns.name}
                    onChange={(e) =>
                      setColumns({ ...columns, name: e.target.value })
                    }
                  >
                    {Object.keys(rows[0]).map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Email column (optional)
                  <select
                    value={columns.email}
                    onChange={(e) =>
                      setColumns({ ...columns, email: e.target.value })
                    }
                  >
                    <option value="">No email column</option>
                    {Object.keys(rows[0]).map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
                <button className="primary wide" onClick={importNames}>
                  Import {rows.length} names
                </button>
              </div>
            )}
            {people.length > 0 && (
              <small className="tag-people-note">
                Duplicate names receive distinct filenames.
              </small>
            )}
            <div className="control-divider" />
            <h2>2. Style the name</h2>
            <label>
              Font type
              <select
                value={style.font}
                onChange={(e) =>
                  update({ font: e.target.value as TagStyle["font"] })
                }
              >
                <option value="Times">Times Roman · serif</option>
                <option value="Helvetica">Helvetica · sans serif</option>
                <option value="Courier">Courier · monospace</option>
                <option value="Custom">Saved fonts (TTF / OTF / WOFF)</option>
              </select>
            </label>
            {style.font === "Custom" && (
              <>
                <input
                  hidden
                  ref={fontInput}
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void uploadFont(file);
                  }}
                />
                <button
                  className="secondary wide"
                  onClick={() => fontInput.current?.click()}
                >
                  <Upload size={15} />
                  Upload & save font
                </button>
                {fontsLoading ? (
                  <small>Loading saved fonts…</small>
                ) : savedFonts.length ? (
                  <div className="font-library" role="listbox" aria-label="Saved fonts">
                    {savedFonts.map((f) => (
                      <div
                        key={f.id}
                        role="option"
                        aria-selected={f.id === activeFontId}
                        className={`font-row${f.id === activeFontId ? " selected" : ""}`}
                      >
                        <button
                          className="font-name"
                          title={f.name}
                          onClick={() => void selectFont(f.id)}
                        >
                          <Type size={14} />
                          <span>{f.name}</span>
                          <small>{Math.max(1, Math.round(f.size / 1024))} KB</small>
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={`Delete saved font ${f.name}`}
                          title="Delete saved font"
                          onClick={() => void removeFont(f.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <small>No saved fonts yet. Upload a TTF, OTF, or WOFF file.</small>
                )}
                <small>
                  Fonts are stored in this browser (IndexedDB), so you only
                  upload once — they are reused automatically after reload.
                  Custom fonts use the style built into the file.
                </small>
              </>
            )}
            <div className="form-grid">
              <label>
                Font size (pt)
                <input
                  type="number"
                  min={6}
                  max={144}
                  value={style.size}
                  onChange={(e) => {
                    if (e.target.value === "") return;
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) update({ size: next });
                  }}
                />
              </label>
              <label>
                Text color
                <input
                  type="color"
                  value={style.color}
                  onChange={(e) => update({ color: e.target.value })}
                />
              </label>
            </div>
            <div className="tag-format">
              <button
                className={style.bold ? "selected" : ""}
                disabled={style.font === "Custom"}
                aria-label="Bold name"
                aria-pressed={style.bold}
                onClick={() => update({ bold: !style.bold })}
              >
                <Bold size={18} />
              </button>
              <button
                className={style.italic ? "selected" : ""}
                disabled={style.font === "Custom"}
                aria-label="Italic name"
                aria-pressed={style.italic}
                onClick={() => update({ italic: !style.italic })}
              >
                <Italic size={18} />
              </button>
              <label>
                Alignment
                <select
                  value={style.align}
                  onChange={(e) =>
                    update({ align: e.target.value as TagStyle["align"] })
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </div>
            <div className="control-divider" />
            <h2>3. Position the name</h2>
            <label>
              Certificate page
              <select
                disabled={!pages.length}
                value={style.page}
                onChange={(e) => update({ page: Number(e.target.value) })}
              >
                {pages.map((_, i) => (
                  <option key={i} value={i}>
                    Page {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Horizontal position (%)
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={100}
                  value={style.x}
                  onChange={(e) => {
                    if (e.target.value === "") return;
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) update({ x: next });
                  }}
                />
              </label>
              <label>
                Baseline from top (%)
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={100}
                  value={style.y}
                  onChange={(e) => {
                    if (e.target.value === "") return;
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) update({ y: next });
                  }}
                />
              </label>
            </div>
            <label>
              Name area width (%)
              <input
                type="range"
                min={10}
                max={100}
                value={style.width}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next)) update({ width: next });
                }}
              />
              <small>{style.width}% of page width</small>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={style.fit}
                onChange={(e) => update({ fit: e.target.checked })}
              />
              Fit long names automatically
            </label>
            <button
              className="text-button"
              onClick={() => update({ x: 50, y: 52 })}
            >
              <RotateCcw size={14} />
              Reset position
            </button>
            <div className="control-divider" />
            <h2>4. Verification QR</h2>
            <label className="check-label">
              <input
                type="checkbox"
                checked={qrStyle.enabled}
                onChange={(e) => {
                  const on = e.target.checked;
                  setQrStyle((previous) => ({ ...previous, enabled: on }));
                  if (on) {
                    setPlaceTarget("qr");
                  } else setPlaceTarget("name");
                }}
              />
              Add verification QR
            </label>
            {qrStyle.enabled && (
              <>
                <label>
                  Training title
                  <input
                    value={training.title}
                    maxLength={150}
                    placeholder="e.g. Digital Literacy Training"
                    onChange={(e) => setTraining({ ...training, title: e.target.value })}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Training date
                    <input
                      type="date"
                      value={training.date}
                      onChange={(e) => setTraining({ ...training, date: e.target.value })}
                    />
                  </label>
                  <label>
                    ID prefix
                    <input
                      value={training.prefix}
                      maxLength={12}
                      onChange={(e) => setTraining({ ...training, prefix: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Issuer
                  <input
                    value={training.issuer}
                    maxLength={120}
                    onChange={(e) => setTraining({ ...training, issuer: e.target.value })}
                  />
                </label>
                <small>
                  Each participant gets a certificate ID (from your CSV’s
                  certificate_id column when present, otherwise generated as
                  DICTSDS-YEAR-MONTH-001 and numbered in list order). The QR
                  holds a readable statement of ID, name, training, date, and
                  issuer.
                </small>
                <div className="control-divider" />
                <h2>QR placement</h2>
                <div className="form-grid">
                  <label>
                    Horizontal center (%)
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={100}
                      value={qrStyle.x}
                      onChange={(e) => {
                        if (e.target.value === "") return;
                        const next = Number(e.target.value);
                        if (Number.isFinite(next))
                          setQrStyle((previous) => ({ ...previous, x: next }));
                      }}
                    />
                  </label>
                  <label>
                    Vertical center (%)
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={100}
                      value={qrStyle.y}
                      onChange={(e) => {
                        if (e.target.value === "") return;
                        const next = Number(e.target.value);
                        if (Number.isFinite(next))
                          setQrStyle((previous) => ({ ...previous, y: next }));
                      }}
                    />
                  </label>
                </div>
                <label>
                  QR size (% of page width)
                  <input
                    type="range"
                    min={5}
                    max={30}
                    value={qrStyle.size}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (Number.isFinite(next))
                        setQrStyle((previous) => ({ ...previous, size: next }));
                    }}
                  />
                  <small>{qrStyle.size}% of page width</small>
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={qrStyle.caption}
                    onChange={(e) =>
                      setQrStyle((previous) => ({ ...previous, caption: e.target.checked }))
                    }
                  />
                  Print certificate ID under the QR
                </label>
              </>
            )}
          </fieldset>
        </aside>
        <section className="panel tagger-preview">
          <div className="preview-toolbar">
            <span>
              <MousePointer2 size={17} />
              {qrStyle.enabled
                ? "Choose what to place, then drag or click on the certificate"
                : "Drag the name to position it, or click to place it"}
            </span>
            <div>
              {qrStyle.enabled && (
                <div className="tag-target-toggle" role="group" aria-label="Placement target">
                  <button
                    className={`icon-button${placeTarget === "name" ? " selected" : ""}`}
                    aria-label="Place the name"
                    aria-pressed={placeTarget === "name"}
                    title="Place the name"
                    onClick={() => setPlaceTarget("name")}
                  >
                    <Type size={17} />
                  </button>
                  <button
                    className={`icon-button${placeTarget === "qr" ? " selected" : ""}`}
                    aria-label="Place the QR code"
                    aria-pressed={placeTarget === "qr"}
                    title="Place the QR code"
                    onClick={() => setPlaceTarget("qr")}
                  >
                    <QrCode size={17} />
                  </button>
                </div>
              )}
              <button
                className="icon-button"
                aria-label="Zoom out certificate"
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
              >
                <ZoomOut size={17} />
              </button>
              <span>{zoom}%</span>
              <button
                className="icon-button"
                aria-label="Zoom in certificate"
                onClick={() => setZoom((z) => Math.min(200, z + 25))}
              >
                <ZoomIn size={17} />
              </button>
            </div>
          </div>
          <div className="tag-preview-person">
            {people.length ? (
              <>
                <button
                  className="icon-button"
                  aria-label="Previous participant"
                  disabled={selected === 0 || !!busy}
                  onClick={() => setSelected(selected - 1)}
                >
                  <ArrowLeft size={16} />
                </button>
                <label>
                  Preview participant
                  <select
                    value={selected}
                    disabled={!!busy}
                    onChange={(e) => setSelected(Number(e.target.value))}
                  >
                    {people.map((p, i) => (
                      <option value={i} key={i}>
                        {i + 1}. {p.name} · {p.certId}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="icon-button"
                  aria-label="Next participant"
                  disabled={selected === people.length - 1 || !!busy}
                  onClick={() => setSelected(selected + 1)}
                >
                  <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <label>
                Preview name
                <input
                  value={sample}
                  disabled={!!busy}
                  onChange={(e) => setSample(e.target.value)}
                />
              </label>
            )}
            <button
              className="secondary"
              disabled={!!busy || previewBusy || !!previewError || !preview}
              onClick={() => {
                if (preview)
                  download(
                    preview,
                    certificateFilename(name),
                    "application/pdf",
                  );
              }}
            >
              <Download size={15} />
              Download preview PDF
            </button>
          </div>
          {style.font === "Custom" && !fontsLoading && !customFont && (
            <div className="notice error tag-preview-error" role="alert">
              No saved font selected. Upload a font or pick one from your saved
              fonts to render names.
            </div>
          )}
          {previewError && (
            <div className="notice error tag-preview-error" role="alert">
              {previewError}
            </div>
          )}
          <div className="tag-canvas-scroll">
            {template ? (
              <div
                className="tag-paper"
                onPointerDown={(e) => {
                  if (busy || e.button !== 0 || drag.current) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const point = {
                    x: ((e.clientX - rect.left) / rect.width) * 100,
                    y: ((e.clientY - rect.top) / rect.height) * 100,
                  };
                  if (placeTarget === "qr" && qrStyle.enabled) {
                    // Grab the QR body without snapping its center to the
                    // pointer. Clicking elsewhere centers the QR there.
                    const half = qrStyle.size / 2;
                    const nearQr =
                      Math.abs(point.x - qrStyle.x) <= half + 2 &&
                      Math.abs(point.y - qrStyle.y) <= half + 4;
                    const origin = nearQr ? { x: qrStyle.x, y: qrStyle.y } : point;
                    drag.current = {
                      id: e.pointerId,
                      kind: "qr",
                      startX: e.clientX,
                      startY: e.clientY,
                      origin,
                      current: origin,
                      rect,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    e.currentTarget.classList.add("is-dragging");
                    moveQr(origin);
                    return;
                  }
                  // Grab anywhere along the name line without snapping its anchor
                  // to the pointer. Clicking elsewhere places the baseline there.
                  const nearName =
                    Math.abs(point.y - style.y) <
                      Math.max(
                        3,
                        (actualSize / (pages[style.page]?.height || 600)) * 100,
                      ) && Math.abs(point.x - style.x) < style.width / 2;
                  const origin = nearName ? { x: style.x, y: style.y } : point;
                  drag.current = {
                    id: e.pointerId,
                    kind: "name",
                    startX: e.clientX,
                    startY: e.clientY,
                    origin,
                    current: origin,
                    rect,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.currentTarget.classList.add("is-dragging");
                  moveName(origin);
                }}
                onPointerMove={movePointer}
                onPointerUp={(e) => finishDrag(e)}
                onPointerCancel={(e) => finishDrag(e, true)}
                onLostPointerCapture={(e) => finishDrag(e, true)}
                style={{ width: `${zoom}%`, aspectRatio: String(pageRatio) }}
              >
                <canvas
                  ref={canvas}
                  aria-label="Certificate placement preview"
                />
                <canvas
                  ref={nameCanvas}
                  className="tag-name-layer"
                  aria-hidden="true"
                />
                <span
                  ref={anchor}
                  className="tag-anchor"
                  style={{ left: `${style.x}%`, top: `${style.y}%` }}
                  aria-hidden="true"
                />
                {qrStyle.enabled && qrImg && (
                  <img
                    ref={qrImgRef}
                    src={qrImg}
                    alt=""
                    aria-hidden="true"
                    className="tag-qr-layer"
                    draggable={false}
                    style={{
                      left: `${qrStyle.x}%`,
                      top: `${qrStyle.y}%`,
                      width: `${qrStyle.size}%`,
                    }}
                  />
                )}
                {slowPreview && (
                  <span className="tag-rendering">
                    <Loader2 size={15} className="spin" />
                    Updating preview
                  </span>
                )}
              </div>
            ) : (
              <div className="empty tag-empty">
                <FileText size={45} />
                <h2>Your certificate goes here</h2>
                <p>
                  Upload a draft PDF, then click where each participant’s name
                  should appear.
                </p>
                <button
                  className="primary"
                  onClick={() => pdfInput.current?.click()}
                >
                  <Upload size={16} />
                  Choose PDF template
                </button>
              </div>
            )}
          </div>
          <div className="tag-quality">
            <CheckCircle2 size={18} />
            <div>
              <strong>Original PDF artwork stays intact</strong>
              <p>
                Only the name{qrStyle.enabled ? " and verification QR" : ""} are added as PDF content. Preview markers are not
                included in downloads.{" "}
                {preview && !previewError
                  ? `Current name: ${actualSize} pt.`
                  : ""}
              </p>
            </div>
          </div>
        </section>
      </div>
      <p className="tag-footnote">
        Template and names stay in this tab until you reload. Saved fonts stay
        in this browser (IndexedDB) so you only upload once. ZIP downloads
        include every original page and a participant CSV with exact certificate
        filenames, certificate IDs, and training details, ready for the
        sending workflow.
      </p>
    </>
  );
}
