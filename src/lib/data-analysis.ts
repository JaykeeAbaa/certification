import { validEmail } from "./model";

export type SexCategory = "male" | "female" | "unspecified";

export type SectorKey =
  | "pwd"
  | "osy"
  | "student"
  | "ip"
  | "teacher"
  | "senior"
  | "other"
  | "unspecified";

export type DetectedColumns = { name: string; sex: string; email: string; sector: string };

export const SECTOR_LABELS: Record<SectorKey, string> = {
  pwd: "PWD",
  osy: "Out of School Youth",
  student: "Students",
  ip: "Indigenous People",
  teacher: "Teachers / Educators",
  senior: "Senior Citizen",
  other: "Other",
  unspecified: "Unspecified",
};

type CanonicalSector = Exclude<SectorKey, "other" | "unspecified">;

const SECTOR_ORDER: CanonicalSector[] = ["osy", "pwd", "ip", "teacher", "student", "senior"];

const SECTOR_TERMS: Record<CanonicalSector, string[]> = {
  osy: ["out of school youth", "out of school", "osy"],
  pwd: ["person with disability", "persons with disabilities", "people with disabilities", "with disability", "pwd"],
  senior: ["senior citizen", "senior citizens", "elderly", "senior"],
  ip: ["indigenous people", "indigenous peoples", "indigenous", "katutubo", "ip"],
  teacher: ["educator", "educators", "instructor", "faculty", "teacher", "teachers"],
  student: ["student", "students", "pupil", "pupils", "learner", "learners"],
};

/** Normalize a sector/category cell to a canonical group. */
export function normalizeSector(value: string): SectorKey {
  const v = ` ${value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  if (!v.trim()) return "unspecified";
  for (const key of SECTOR_ORDER) {
    if (SECTOR_TERMS[key].some((t) => v.includes(` ${t} `))) return key;
  }
  return "other";
}

/** Normalize a raw sex/gender cell. Handles case, single letters, and Filipino terms. */
export function normalizeSex(value: string): SexCategory {
  const v = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["m", "male", "man", "lalaki", "boy", "mr"].includes(v)) return "male";
  if (["f", "female", "woman", "babae", "girl", "ms", "mrs"].includes(v)) return "female";
  return "unspecified";
}

/** Normalize a name for duplicate detection: case, spacing, punctuation, diacritics. */
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "vi", "vii", "viii"]);

/**
 * First + last name key. Middle names, initials, and suffixes (Jr/Sr/II…)
 * are ignored, since duplicates usually share first and last name only:
 * "Juan D. Cruz" and "Juan Dela Cruz Jr" both key as "juan cruz".
 */
export function nameKey(value: string): string {
  const tokens = normalizeName(value).split(" ").filter(Boolean);
  const stripped = [...tokens];
  while (stripped.length > 1 && NAME_SUFFIXES.has(stripped[stripped.length - 1])) stripped.pop();
  if (!stripped.length) return "";
  if (stripped.length === 1) return stripped[0];
  return `${stripped[0]} ${stripped[stripped.length - 1]}`;
}

export function detectColumns(fields: string[]): DetectedColumns {
  const find = (re: RegExp) => fields.find((f) => re.test(f)) || "";
  return {
    name:
      find(/^(name|full.?name|participant.?name| beneficiaries?|trainee)$/i) ||
      fields.find((f) => /name/i.test(f)) ||
      fields[0] ||
      "",
    sex:
      fields.find((f) => /^(sex|gender|kasarian)$/i.test(f.trim())) ||
      fields.find((f) => /sex|gender|kasarian/i.test(f)) ||
      "",
    email: fields.find((f) => /e-?mail/i.test(f)) || "",
    sector:
      fields.find((f) => /^(sector|category|categories|clientele|beneficiar(y|ies)|client.?group)$/i.test(f.trim())) ||
      fields.find((f) => /sector|categor|clientele|benefic/i.test(f)) ||
      "",
  };
}

export type RowFlag =
  | "missing-name"
  | "invalid-email"
  | "duplicate-name"
  | "duplicate-email"
  | "exact-duplicate";

export type AnalyzedRow = {
  index: number;
  data: Record<string, string>;
  name: string;
  sex: SexCategory;
  sector: SectorKey;
  flags: RowFlag[];
};

export type DuplicateGroup = {
  kind: "name" | "email" | "row";
  label: string;
  detail?: string;
  rows: number[];
};

export type AnalysisResult = {
  total: number;
  male: number;
  female: number;
  unspecified: number;
  sectors: Record<SectorKey, number>;
  flagged: number;
  duplicateRows: number;
  exactDuplicates: number;
  groups: DuplicateGroup[];
  rows: AnalyzedRow[];
};

export function analyzeRows(
  input: Record<string, string>[],
  cols: DetectedColumns,
): AnalysisResult {
  const rows: AnalyzedRow[] = input.map((data, i) => ({
    index: i,
    data,
    name: cols.name ? (data[cols.name] || "").trim() : "",
    sex: cols.sex ? normalizeSex(data[cols.sex] || "") : "unspecified",
    sector: cols.sector ? normalizeSector(data[cols.sector] || "") : "unspecified",
    flags: [] as RowFlag[],
  }));

  const byName = new Map<string, number[]>();
  const byEmail = new Map<string, number[]>();
  const byRow = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (!r.name) {
      r.flags.push("missing-name");
      return;
    }
    const nk = nameKey(r.name);
    if (nk) {
      if (!byName.has(nk)) byName.set(nk, []);
      byName.get(nk)!.push(i);
    }
    const email = cols.email ? (r.data[cols.email] || "").trim().toLowerCase() : "";
    if (email) {
      if (!validEmail(email)) r.flags.push("invalid-email");
      else {
        if (!byEmail.has(email)) byEmail.set(email, []);
        byEmail.get(email)!.push(i);
      }
    }
    const rowKey = `${normalizeName(r.name)}||${email}`;
    if (!byRow.has(rowKey)) byRow.set(rowKey, []);
    byRow.get(rowKey)!.push(i);
  });

  const groups: DuplicateGroup[] = [];

  for (const [key, idx] of byName) {
    if (idx.length > 1) {
      idx.forEach((i) => {
        if (!rows[i].flags.includes("duplicate-name")) rows[i].flags.push("duplicate-name");
      });
      groups.push({ kind: "name", label: rows[idx[0]].name, detail: `First + last name: “${key}”`, rows: idx });
    }
  }
  for (const [key, idx] of byEmail) {
    if (idx.length > 1) {
      idx.forEach((i) => {
        if (!rows[i].flags.includes("duplicate-email")) rows[i].flags.push("duplicate-email");
      });
      groups.push({ kind: "email", label: key, rows: idx });
    }
  }
  let exactDuplicates = 0;
  for (const [, idx] of byRow) {
    if (idx.length > 1) {
      idx.forEach((i) => {
        if (!rows[i].flags.includes("exact-duplicate")) {
          rows[i].flags.push("exact-duplicate");
          exactDuplicates++;
        }
      });
      const first = rows[idx[0]];
      const email = cols.email ? (first.data[cols.email] || "").trim() : "";
      groups.push({
        kind: "row",
        label: first.name + (email ? ` · ${email}` : ""),
        rows: idx,
      });
    }
  }

  const dupRows = new Set<number>();
  rows.forEach((r, i) => {
    if (r.flags.includes("duplicate-name") || r.flags.includes("duplicate-email")) dupRows.add(i);
  });
  const sectors = {
    pwd: 0,
    osy: 0,
    student: 0,
    ip: 0,
    teacher: 0,
    senior: 0,
    other: 0,
    unspecified: 0,
  } satisfies Record<SectorKey, number>;
  rows.forEach((r) => {
    sectors[r.sector]++;
  });
  return {
    total: rows.length,
    male: rows.filter((r) => r.sex === "male").length,
    female: rows.filter((r) => r.sex === "female").length,
    unspecified: rows.filter((r) => r.sex === "unspecified").length,
    sectors,
    flagged: rows.filter((r) => r.flags.length > 0).length,
    duplicateRows: dupRows.size,
    exactDuplicates,
    groups: groups.sort((a, b) => b.rows.length - a.rows.length),
    rows,
  };
}

export const FLAG_LABELS: Record<RowFlag, string> = {
  "missing-name": "Missing name",
  "invalid-email": "Invalid email",
  "duplicate-name": "Duplicate name",
  "duplicate-email": "Duplicate email",
  "exact-duplicate": "Exact duplicate",
};

/**
 * Indices to delete so each duplicate group keeps only its first occurrence.
 * Pass kinds to limit the scope, e.g. ["row"] for exact duplicates only.
 */
export function keepFirstIndices(
  groups: DuplicateGroup[],
  kinds: DuplicateGroup["kind"][] = ["name", "email", "row"],
): Set<number> {
  const del = new Set<number>();
  for (const g of groups) {
    if (!kinds.includes(g.kind)) continue;
    g.rows.slice(1).forEach((i) => del.add(i));
  }
  return del;
}
