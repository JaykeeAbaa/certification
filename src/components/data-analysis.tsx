"use client";
import { useMemo, useRef, useState } from "react";
import {
  Upload,
  Users,
  Download,
  Search,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Copy,
  FileText,
  Trash2,
  X,
} from "lucide-react";
import Papa from "papaparse";
import {
  detectColumns,
  analyzeRows,
  keepFirstIndices,
  FLAG_LABELS,
  SECTOR_LABELS,
  type DetectedColumns,
  type SexCategory,
  type SectorKey,
  type RowFlag,
} from "@/lib/data-analysis";
import { csvCell } from "@/lib/model";

const PAGE_SIZE = 20;

function downloadCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function DataAnalysis() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [filename, setFilename] = useState("");
  const [cols, setCols] = useState<DetectedColumns>({ name: "", sex: "", email: "", sector: "" });
  const [search, setSearch] = useState("");
  const [sexFilter, setSexFilter] = useState<"all" | SexCategory>("all");
  const [sectorFilter, setSectorFilter] = useState<"all" | SectorKey>("all");
  const [flagFilter, setFlagFilter] = useState<"all" | "flagged" | "clean" | RowFlag>("all");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [groupRows, setGroupRows] = useState<number[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function loadFile(file?: File) {
    if (!file) return;
    setError("");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose a CSV under 5 MB.");
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
        if (!result.data.length || result.data.length > 5000) {
          setError("Import between 1 and 5,000 rows per analysis.");
          return;
        }
        const headers = result.meta.fields || [];
        setRows(result.data);
        setFields(headers);
        setFilename(file.name);
        setCols(detectColumns(headers));
        setSearch("");
        setSexFilter("all");
        setSectorFilter("all");
        setFlagFilter("all");
        setGroupRows(null);
        setNotice("");
        setSort(null);
        setPage(0);
      },
    });
  }

  const result = useMemo(
    () => (rows.length ? analyzeRows(rows, cols) : null),
    [rows, cols],
  );

  const filtered = useMemo(() => {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    let list = result.rows.filter((r) => {
      if (groupRows && !groupRows.includes(r.index)) return false;
      if (sexFilter !== "all" && r.sex !== sexFilter) return false;
      if (sectorFilter !== "all" && r.sector !== sectorFilter) return false;
      if (flagFilter === "flagged" && !r.flags.length) return false;
      if (flagFilter === "clean" && r.flags.length) return false;
      if ((["missing-name", "invalid-email", "duplicate-name", "duplicate-email", "exact-duplicate"] as const).includes(flagFilter as RowFlag)) {
        if (!r.flags.includes(flagFilter as RowFlag)) return false;
      }
      if (q) {
        const hay = [...Object.values(r.data), r.sex, SECTOR_LABELS[r.sector], r.flags.join(" ")].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sort) {
      list = [...list].sort((a, b) => {
        const av = sort.key === "_sex" ? a.sex : sort.key === "_row" ? String(a.index) : (a.data[sort.key] || "");
        const bv = sort.key === "_sex" ? b.sex : sort.key === "_row" ? String(b.index) : (b.data[sort.key] || "");
        const cmp = sort.key === "_row" ? Number(av) - Number(bv) : av.localeCompare(bv);
        return cmp * sort.dir;
      });
    }
    return list;
  }, [result, search, sexFilter, sectorFilter, flagFilter, sort, groupRows]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: string) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
    setPage(0);
  }

  function removeAt(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setPage(0);
    setGroupRows(null);
    setNotice("Row deleted. Re-upload the file to restore it.");
  }

  function removeDuplicates(kinds?: ("name" | "email" | "row")[]) {
    if (!result) return;
    const del = keepFirstIndices(result.groups, kinds);
    if (!del.size) return;
    setRows((prev) => prev.filter((_, i) => !del.has(i)));
    setPage(0);
    setGroupRows(null);
    setNotice(`Deleted ${del.size} duplicate row${del.size === 1 ? "" : "s"}, keeping the first occurrence.`);
  }

  function exportFlagged() {
    if (!result) return;
    const header = [...fields, "analysis_sex", "analysis_sector", "analysis_flags"];
    const lines = result.rows.map((r) =>
      [...fields.map((f) => r.data[f] || ""), r.sex, SECTOR_LABELS[r.sector], r.flags.map((f) => FLAG_LABELS[f]).join("; ")].map(csvCell).join(","),
    );
    downloadCsv("analysis-report.csv", header.map(csvCell).join(",") + "\r\n" + lines.join("\r\n"));
  }

  const pct = (n: number) => (result && result.total ? Math.round((n / result.total) * 100) : 0);

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">UPLOAD. UNDERSTAND. CLEAN.</div>
          <h1>Data analysis</h1>
          <p>Upload a participant list and get accurate headcounts, sex breakdowns, and duplicate detection.</p>
        </div>
        {result && (
          <div className="actions">
            <button className="secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={16} />
              New file
            </button>
            <button className="primary" onClick={exportFlagged}>
              <Download size={16} />
              Report CSV
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        hidden
        type="file"
        accept=".csv"
        onChange={(e) => {
          loadFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
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
          <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!result ? (
        <div className="panel empty">
          <FileText size={45} />
          <h2>Drop in your participant CSV</h2>
          <p>
            Columns are detected automatically — name, sex/gender (M/F, lalaki/babae),
            sector (PWD, students, seniors…), and email. Up to 5,000 rows, everything stays on this computer.
          </p>
          <button className="primary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} />
            Choose CSV file
          </button>
          <button
            className="text-button"
            onClick={() =>
              downloadCsv(
                "participants-sample.csv",
                "name,sex,email\r\nAlex Santos,Male,alex@example.com\r\nJamie Reyes,Female,jamie@example.com\r\n",
              )
            }
          >
            <Download size={14} />
            CSV example
          </button>
        </div>
      ) : (
        <>
          <div className="da-stats">
            {[
              { label: "Total participants", value: result.total, color: "#164dce" },
              { label: "Male", value: result.male, color: "#3767d1" },
              { label: "Female", value: result.female, color: "#b45c8a" },
              { label: "Unspecified sex", value: result.unspecified, color: "#8590a2" },
              { label: "Duplicate rows", value: result.duplicateRows, color: result.duplicateRows ? "#b33b45" : "#368362" },
            ].map((s) => (
              <div className="panel da-stat" key={s.label}>
                <span style={{ background: s.color }} />
                <strong>{s.value}</strong>
                <small>{s.label}</small>
              </div>
            ))}
          </div>
          <div className="panel da-bar-panel">
            <div>
              <strong>Sex distribution</strong>
              <small>
                {filename} · {result.total} rows · {result.flagged} flagged · {result.exactDuplicates} exact duplicates
              </small>
            </div>
            <div className="da-bar" role="img" aria-label={`${result.male} male, ${result.female} female, ${result.unspecified} unspecified`}>
              {result.male > 0 && <span style={{ width: `${(result.male / result.total) * 100}%` }} className="da-male" />}
              {result.female > 0 && <span style={{ width: `${(result.female / result.total) * 100}%` }} className="da-female" />}
              {result.unspecified > 0 && <span style={{ width: `${(result.unspecified / result.total) * 100}%` }} className="da-na" />}
            </div>
            <div className="da-legend">
              <span><i className="da-male" /> Male {pct(result.male)}%</span>
              <span><i className="da-female" /> Female {pct(result.female)}%</span>
              <span><i className="da-na" /> Unspecified {pct(result.unspecified)}%</span>
            </div>
          </div>
          <section className="panel da-mapping">
            <div className="section-heading">
              <div>
                <h2>Sectors</h2>
                <p>How many PWDs, out-of-school youth, students, indigenous people, teachers/educators, and senior citizens.</p>
              </div>
              <Users size={22} />
            </div>
            <div className="da-sectors">
              {(
                (["pwd", "osy", "student", "ip", "teacher", "senior"] as const)
                  .map((k) => ({ key: k as SectorKey, value: result.sectors[k] }))
                  .concat(
                    result.sectors.other > 0 ? [{ key: "other" as SectorKey, value: result.sectors.other }] : [],
                    result.sectors.unspecified > 0 || !cols.sector
                      ? [{ key: "unspecified" as SectorKey, value: result.sectors.unspecified }]
                      : [],
                  )
              ).map((s) => (
                <button
                  key={s.key}
                  className={`da-sector${sectorFilter === s.key ? " selected" : ""}`}
                  onClick={() => {
                    setSectorFilter(sectorFilter === s.key ? "all" : s.key);
                    setPage(0);
                  }}
                  title={sectorFilter === s.key ? "Clear sector filter" : "Filter table to this sector"}
                >
                  <strong>{s.value}</strong>
                  <small>{SECTOR_LABELS[s.key]}</small>
                  <span className="da-sector-pct">{pct(s.value)}%</span>
                </button>
              ))}
            </div>
            {!cols.sector && (
              <p className="da-hint">No sector column detected — map one above to break this down.</p>
            )}
          </section>
          <section className="panel da-mapping">
            <div className="section-heading">
              <div>
                <h2>Column mapping</h2>
                <p>Detected automatically — correct it if your headers are unusual.</p>
              </div>
            </div>
            <div className="form-grid" style={{ padding: "0 26px 26px" }}>
              {(
                [
                  ["name", "Name column"],
                  ["sex", "Sex column"],
                  ["sector", "Sector column"],
                  ["email", "Email column (optional)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select value={cols[key]} onChange={(e) => setCols({ ...cols, [key]: e.target.value })}>
                    {key !== "name" && (
                      <option value="">
                        {key === "sex" ? "No sex column" : key === "sector" ? "No sector column" : "No email column"}
                      </option>
                    )}
                    {fields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
          {result.groups.length > 0 && (
            <section className="panel da-mapping">
              <div className="section-heading">
                <div>
                  <h2>Duplicates ({result.groups.length})</h2>
                  <p>Names match on first + last name (middle names and Jr/Sr ignored); emails match exactly. Click a group to filter the table.</p>
                </div>
                <Copy size={22} />
              </div>
              <div className="da-bulk">
                <button className="text-button danger" onClick={() => removeDuplicates(["row"])}>
                  <Trash2 size={14} />
                  Delete exact duplicates (keep first)
                </button>
                <button className="text-button danger" onClick={() => removeDuplicates()}>
                  <Trash2 size={14} />
                  Delete all duplicates (keep first)
                </button>
              </div>
              <div className="da-groups">
                {result.groups.map((g, i) => (
                  <div key={i} className="da-group">
                    <button
                      className="da-group-main"
                      onClick={() => {
                        setGroupRows(g.rows);
                        setPage(0);
                      }}
                      title="Show only these rows in the table"
                    >
                      <span className={`da-kind da-kind-${g.kind}`}>
                        {g.kind === "name" ? "Name" : g.kind === "email" ? "Email" : "Row"}
                      </span>
                      <span className="da-group-text">
                        <span className="da-group-label">{g.label}</span>
                        {g.detail && <small>{g.detail}</small>}
                      </span>
                      <span className="nav-count">{g.rows.length} rows</span>
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={`Keep first occurrence of ${g.label}, delete the rest`}
                      title="Keep first occurrence, delete the rest"
                      onClick={() => {
                        const del = new Set(g.rows.slice(1));
                        setRows((prev) => prev.filter((_, r) => !del.has(r)));
                        setPage(0);
                        setGroupRows(null);
                        setNotice(`Deleted ${del.size} duplicate row${del.size === 1 ? "" : "s"}, keeping “${g.label}”.`);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Records ({filtered.length})</h2>
                <p>Click a column header to sort. Flagged rows show what needs attention.</p>
              </div>
              <div className="search">
                <Search size={15} />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search records…" />
              </div>
            </div>
            <div className="da-filters">
              <label>
                Sex
                <select value={sexFilter} onChange={(e) => { setSexFilter(e.target.value as typeof sexFilter); setPage(0); }}>
                  <option value="all">All</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="unspecified">Unspecified</option>
                </select>
              </label>
              <label>
                Flags
                <select value={flagFilter} onChange={(e) => { setFlagFilter(e.target.value as typeof flagFilter); setPage(0); }}>
                  <option value="all">All rows</option>
                  <option value="flagged">Flagged only</option>
                  <option value="clean">Clean only</option>
                  <option value="missing-name">Missing name</option>
                  <option value="invalid-email">Invalid email</option>
                  <option value="duplicate-name">Duplicate name</option>
                  <option value="duplicate-email">Duplicate email</option>
                  <option value="exact-duplicate">Exact duplicate</option>
                </select>
              </label>
              <label>
                Sector
                <select value={sectorFilter} onChange={(e) => { setSectorFilter(e.target.value as typeof sectorFilter); setPage(0); }}>
                  <option value="all">All sectors</option>
                  {(Object.keys(SECTOR_LABELS) as SectorKey[]).map((k) => (
                    <option key={k} value={k}>{SECTOR_LABELS[k]}</option>
                  ))}
                </select>
              </label>
              {search && (
                <button className="text-button" onClick={() => setSearch("")}>
                  Clear search
                </button>
              )}
              {groupRows && (
                <button className="text-button" onClick={() => setGroupRows(null)}>
                  Show all rows ({groupRows.length} in group)
                </button>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th onClick={() => toggleSort("_row")} className="sortable">
                      # {sort?.key === "_row" ? (sort.dir === 1 ? "↑" : "↓") : ""}
                    </th>
                    {fields.map((f) => (
                      <th key={f} onClick={() => toggleSort(f)} className="sortable">
                        {f.toUpperCase()} {sort?.key === f ? (sort.dir === 1 ? "↑" : "↓") : ""}
                      </th>
                    ))}
                    <th onClick={() => toggleSort("_sex")} className="sortable">
                      SEX {sort?.key === "_sex" ? (sort.dir === 1 ? "↑" : "↓") : ""}
                    </th>
                    <th>FLAGS</th>
                    <th aria-label="Row actions" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.index} className={r.flags.length ? "da-flagged" : ""}>
                      <td>{r.index + 1}</td>
                      {fields.map((f) => (
                        <td key={f}>{r.data[f] || <span className="da-empty">—</span>}</td>
                      ))}
                      <td>
                        <span className={`da-sex da-sex-${r.sex}`}>{r.sex}</span>
                      </td>
                      <td>
                        {r.flags.length ? (
                          <span className="da-flags">
                            {r.flags.map((f) => (
                              <span key={f} className={`da-flag da-flag-${f}`}>
                                {FLAG_LABELS[f]}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="da-clean">
                            <CheckCircle2 size={14} /> Clean
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon-button danger"
                          aria-label={`Delete row ${r.index + 1} (${r.name || "unnamed"})`}
                          title="Delete this row"
                          onClick={() => removeAt(r.index)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visible.length && (
              <div className="empty small">
                <Users size={28} />
                <h3>No records match</h3>
                <p>Adjust the search or filters.</p>
              </div>
            )}
            <div className="da-pager">
              <button className="icon-button" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                <ArrowLeft size={16} />
              </button>
              <span>Page {safePage + 1} of {pages} · {filtered.length} records</span>
              <button className="icon-button" aria-label="Next page" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>
                <ArrowRight size={16} />
              </button>
            </div>
            {result.flagged > 0 && (
              <div className="attachment-note">
                <AlertTriangle size={18} />
                <span>
                  {result.flagged} of {result.total} rows need attention.
                  <small>Fix duplicates and missing data in your source file, then re-upload to confirm a clean list.</small>
                </span>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
