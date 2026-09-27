export type SavedFontMeta = {
  id: string;
  name: string;
  size: number;
  createdAt: number;
};

export type SavedFont = SavedFontMeta & {
  data: Uint8Array;
};

const DB_NAME = "certification-tagger";
const STORE = "fonts";
const DB_VERSION = 1;
const LAST_USED_KEY = "tagger:lastFontId";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open font storage."));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        let request: IDBRequest<T>;
        try {
          request = fn(store);
        } catch (e) {
          db.close();
          reject(e instanceof Error ? e : new Error("Font storage failed."));
          return;
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Font storage failed."));
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("Font storage failed."));
        };
      }),
  );
}

type StoredFont = { id: string; name: string; size: number; createdAt: number; data: ArrayBuffer };

export async function listSavedFonts(): Promise<SavedFontMeta[]> {
  const all = await tx<Array<StoredFont | SavedFontMeta>>("readonly", (store) => store.getAll());
  return (all as Array<StoredFont | SavedFontMeta>)
    .map(({ id, name, size, createdAt }) => ({ id, name, size, createdAt }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getSavedFont(id: string): Promise<SavedFont | null> {
  const found = await tx<StoredFont | undefined>("readonly", (store) => store.get(id));
  if (!found || !(found as StoredFont).data) return null;
  const stored = found as StoredFont;
  return {
    id: stored.id,
    name: stored.name,
    size: stored.size,
    createdAt: stored.createdAt,
    data: new Uint8Array(stored.data),
  };
}

export async function saveFontFile(file: File): Promise<SavedFontMeta> {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name) && file.type !== "font/ttf" && file.type !== "font/otf") {
    throw new Error("Choose a TTF, OTF, or WOFF font file.");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("Font must be under 10 MB.");
  const buffer = await file.arrayBuffer();
  // Validate that pdf-lib/fontkit can actually embed it before persisting.
  try {
    const { PDFDocument } = await import("pdf-lib");
    const { default: fontkit } = await import("@pdf-lib/fontkit");
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    await doc.embedFont(new Uint8Array(buffer), { subset: true });
  } catch {
    throw new Error("This font could not be embedded. Choose a valid TTF, OTF, or WOFF font.");
  }
  const meta: StoredFont = {
    id: crypto.randomUUID(),
    name: file.name.replace(/^\.+/, "").slice(0, 120) || "Custom font",
    size: file.size,
    createdAt: Date.now(),
    data: buffer,
  };
  await tx("readwrite", (store) => store.put(meta));
  setLastUsedFontId(meta.id);
  const { data: _omit, ...rest } = meta;
  return rest;
}

export async function deleteSavedFont(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
  if (getLastUsedFontId() === id) {
    try {
      localStorage.removeItem(LAST_USED_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

export function getLastUsedFontId(): string | null {
  try {
    return localStorage.getItem(LAST_USED_KEY);
  } catch {
    return null;
  }
}

export function setLastUsedFontId(id: string): void {
  try {
    localStorage.setItem(LAST_USED_KEY, id);
  } catch {
    /* storage unavailable */
  }
}
