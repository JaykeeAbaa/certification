"use client";
import { useEffect, useRef, useState } from "react";
import {
  Award,
  LayoutDashboard,
  Mail,
  Users,
  BarChart3,
  Settings,
  Plus,
  ArrowRight,
  ArrowLeft,
  Upload,
  FileText,
  Check,
  CheckCircle2,
  Search,
  ChevronRight,
  Download,
  Eye,
  Trash2,
  Send,
  Save,
  Monitor,
  Smartphone,
  GripVertical,
  Type,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  Copy,
  ShieldCheck,
  Pause,
  RotateCcw,
  X,
  Palette,
  FolderOpen,
  Loader2,
} from "lucide-react";
import Papa from "papaparse";
import JSZip from "jszip";
import { api, uploadCertificate } from "@/lib/browser";
import CertificateTagger from "./certificate-tagger";
import DataAnalysis from "./data-analysis";
import {
  Campaign,
  Certificate,
  Recipient,
  Job,
  Design,
  newCampaign,
  matchCertificate,
  issues,
  renderEmail,
  csvCell,
} from "@/lib/model";
type Template = { id: string; name: string; design: Design };
type Sender = {
  host: string;
  port: number;
  email: string;
  sender_name: string;
  per_minute: number;
  daily_limit: number;
  password: string;
  verified?: boolean;
};
const initialSender: Sender = {
  host: "smtp.gmail.com",
  port: 465,
  email: "",
  sender_name: "DICT Caraga",
  per_minute: 10,
  daily_limit: 400,
  password: "",
};
const steps = [
  "Training details",
  "Recipients & files",
  "Design email",
  "Review & send",
];
function download(name: string, data: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function Workspace() {
  const [view, setView] = useState("dashboard"),
    [campaigns, setCampaigns] = useState<Campaign[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [campaign, setCampaign] = useState<Campaign | null>(null),
    [certificates, setCertificates] = useState<Certificate[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [sender, setSender] = useState<Sender>(initialSender),
    [confirm, setConfirm] = useState(false),
    [mobile, setMobile] = useState(false),
    [selectedBlock, setSelectedBlock] = useState("1"),
    [previewName, setPreviewName] = useState("Training participant"),
    [csvRows, setCsvRows] = useState<Record<string, string>[]>([]),
    [columns, setColumns] = useState({
      name: "name",
      email: "email",
      filename: "certificate_filename",
    }),
    [templateName, setTemplateName] = useState("");
  const drag = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  }
  async function refresh() {
    const data = await api("/api/workspace");
    setCampaigns(data.campaigns);
    setTemplates(data.templates);
    if (data.smtp) setSender({ ...data.smtp, password: "" });
  }
  useEffect(() => {
    void run("Loading workspace", refresh);
  }, []);
  useEffect(() => {
    if (!campaign || campaign.status === "draft") return;
    const timer = setInterval(() => {
      api("/api/workspace?id=" + campaign.id)
        .then((data) => {
          setJobs(data.jobs);
          setCampaign(data.campaign);
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [campaign?.id, campaign?.status]);
  function patch(update: Partial<Campaign>) {
    setCampaign((c) => (c ? { ...c, ...update } : c));
  }
  function design(update: Partial<Design>) {
    if (campaign) patch({ design: { ...campaign.design, ...update } });
  }
  async function save() {
    if (!campaign) return;
    await api("/api/workspace", { action: "save", campaign });
  }
  async function open(c: Campaign) {
    await run("Opening campaign", async () => {
      const data = await api("/api/workspace?id=" + c.id);
      setCampaign(data.campaign);
      setCertificates(data.certificates);
      setJobs(data.jobs);
      setStep(c.status === "draft" ? 0 : 3);
      setView("campaign");
    });
  }
  function create() {
    setCampaign(newCampaign());
    setCertificates([]);
    setJobs([]);
    setStep(0);
    setView("campaign");
    setError("");
    setNotice("");
  }
  async function uploadFiles(files: FileList | null) {
    if (!files || !campaign) return;
    // Snapshot before the input is reset or any asynchronous work begins.
    const selectedFiles = Array.from(files);
    if (!selectedFiles.length) return;
    await run("Preparing uploads", async () => {
      await save();
      const pdfs: File[] = [];
      let total = 0;
      for (const file of selectedFiles) {
        if (file.name.toLowerCase().endsWith(".zip")) {
          if (file.size > 50 * 1024 * 1024)
            throw new Error("ZIP files must be under 50 MB.");
          const zip = await JSZip.loadAsync(file);
          const entries = Object.values(zip.files).filter((f) => !f.dir);
          if (entries.length > 2000)
            throw new Error("ZIP contains too many files.");
          for (const f of entries) {
            if (!f.name.toLowerCase().endsWith(".pdf")) continue;
            const declared = (
              f as unknown as { _data?: { uncompressedSize: number } }
            )._data?.uncompressedSize;
            if (
              !declared ||
              declared > 10 * 1024 * 1024 ||
              total + declared > 100 * 1024 * 1024
            )
              throw new Error(
                "ZIP exceeds the 10 MB per PDF or 100 MB expanded limit.",
              );
            const content = await f.async("uint8array");
            total += content.length;
            pdfs.push(
              new File([new Uint8Array(content)], f.name.split("/").pop()!, {
                type: "application/pdf",
              }),
            );
          }
        } else {
          if (!file.name.toLowerCase().endsWith(".pdf"))
            throw new Error(
              "Choose PDF certificates or a ZIP containing PDFs.",
            );
          total += file.size;
          pdfs.push(file);
        }
      }
      if (total > 100 * 1024 * 1024 || pdfs.length > 2000)
        throw new Error("Upload at most 100 MB and 2,000 PDFs at once.");
      if (!pdfs.length)
        throw new Error("No PDF certificates were found in the selected ZIP.");
      if (certificates.length + pdfs.length > 2000)
        throw new Error("Maximum 2,000 certificates per campaign.");
      const added: Certificate[] = [];
      try {
        for (let i = 0; i < pdfs.length; i++) {
          const file = pdfs[i];
          setBusy(`Uploading certificate ${i + 1} of ${pdfs.length}`);
          if (
            file.size > 10485760 ||
            new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !==
              "%PDF-"
          )
            throw new Error(`${file.name}: upload a PDF under 10 MB.`);
          const result = {
            certificate: await uploadCertificate(campaign.id, file),
          };
          added.push(result.certificate);
          setCertificates((previous) => [...previous, result.certificate]);
        }
      } finally {
        const all = [...certificates, ...added];
        patch({
          recipients: campaign.recipients.map((r) => ({
            ...r,
            certificate: r.certificate || matchCertificate(r.name, "", all),
          })),
        });
      }
      setNotice(
        `${added.length} certificates saved on this computer. Review the matches before sending.`,
      );
    });
  }
  function readCsv(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("CSV must be under 2 MB.");
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
      complete: (r) => {
        if (r.errors.length) {
          setError("CSV could not be read: " + r.errors[0].message);
          return;
        }
        if (r.data.length > 2000) {
          setError("Maximum 2,000 recipients per campaign.");
          return;
        }
        setCsvRows(r.data);
        const fields = r.meta.fields || [];
        setColumns({
          name:
            fields.find((f) =>
              /^(full.?name|name|participant.?name)$/i.test(f),
            ) ||
            fields[0] ||
            "",
          email: fields.find((f) => /email/i.test(f)) || "",
          filename: fields.find((f) => /file/i.test(f)) || "",
        });
      },
    });
  }
  function importCsv() {
    patch({
      recipients: csvRows.map((row) => ({
        id: crypto.randomUUID(),
        name: (row[columns.name] || "").trim(),
        email: (row[columns.email] || "").trim(),
        certificate: matchCertificate(
          row[columns.name] || "",
          row[columns.filename] || "",
          certificates,
        ),
        excluded: false,
      })),
    });
    setCsvRows([]);
    setNotice(
      "Recipients imported. Review and correct the certificate matches.",
    );
  }
  async function action(name: string) {
    if (!campaign) return;
    await run("Updating campaign", async () => {
      await api("/api/workspace", { action: name, id: campaign.id });
      const data = await api("/api/workspace?id=" + campaign.id);
      setCampaign(data.campaign);
      setJobs(data.jobs);
      await refresh();
      setNotice(
        name === "test"
          ? `Test submitted to ${sender.email}. Check your inbox and attachment.`
          : "Campaign updated.",
      );
    });
  }
  const active = campaign?.recipients.filter((r) => !r.excluded) || [];
  const problems = issues(campaign?.recipients || []);
  const invalid = [...problems.values()].filter(Boolean).length;
  const locked = campaign?.status !== "draft";
  const block = campaign?.design.blocks.find((b) => b.id === selectedBlock);
  const accepted = jobs.filter((j) => j.status === "accepted").length;
  function updateBlock(values: Partial<Design["blocks"][number]>) {
    if (campaign)
      design({
        blocks: campaign.design.blocks.map((b) =>
          b.id === selectedBlock ? { ...b, ...values } : b,
        ),
      });
  }
  function addBlock(type: Design["blocks"][number]["type"]) {
    if (!campaign) return;
    const id = crypto.randomUUID();
    design({
      blocks: [
        ...campaign.design.blocks,
        {
          id,
          type,
          text:
            type === "heading"
              ? "Your heading"
              : type === "text"
                ? "Add your message here."
                : type === "button"
                  ? "Learn more"
                  : "",
          url: "",
        },
      ],
    });
    setSelectedBlock(id);
  }
  const nav = [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "campaigns", label: "Campaigns", icon: Mail },
    { id: "templates", label: "Email templates", icon: Palette },
    { id: "tagger", label: "Certificate tagger", icon: FileText },
    { id: "analysis", label: "Data analysis", icon: BarChart3 },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Certify home">
          <span className="brand-mark">
            <Award size={25} />
          </span>
          <span>
            certify<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">DICT WORKSPACE</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={
                view === n.id || (view === "campaign" && n.id === "campaigns")
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() => {
                setView(n.id);
                run("Loading workspace", refresh);
              }}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "campaigns" && campaigns.length > 0 && (
                <span className="nav-count">{campaigns.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={20} />
            <div>
              <strong>Made for your next milestone</strong>
              <p>Every certificate. The right inbox.</p>
            </div>
          </div>
          <button
            className={"nav-item " + (view === "settings" ? "active" : "")}
            onClick={() => setView("settings")}
          >
            <Settings size={19} />
            Workspace settings
          </button>
          <div className="profile">
            <span className="avatar">DC</span>
            <div>
              <strong>DICT Caraga</strong>
              <small>Local certificate workspace</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <main>
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
          {busy && (
            <div className="busy" role="status">
              <Loader2 size={16} className="spin" />
              {busy}
            </div>
          )}
          {(view === "dashboard" || view === "campaigns") && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">LEARNING DESERVES RECOGNITION</div>
                  <h1>
                    {view === "dashboard"
                      ? "A good day to celebrate progress."
                      : "Your certificate campaigns"}
                  </h1>
                  <p>Turn training milestones into something worth opening.</p>
                </div>
                <button className="primary" onClick={create}>
                  <Plus size={18} />
                  Create campaign
                </button>
              </div>
              <div className="stats">
                <div className="stat">
                  <span className="stat-icon blue">
                    <Mail size={21} />
                  </span>
                  <div>
                    <span>Total campaigns</span>
                    <strong>
                      {campaigns.length.toString().padStart(2, "0")}
                    </strong>
                  </div>
                  <small>Your training events</small>
                </div>
                <div className="stat">
                  <span className="stat-icon amber">
                    <FileText size={21} />
                  </span>
                  <div>
                    <span>Drafts in progress</span>
                    <strong>
                      {campaigns
                        .filter((c) => c.status === "draft")
                        .length.toString()
                        .padStart(2, "0")}
                    </strong>
                  </div>
                  <small>Ready for your next step</small>
                </div>
                <div className="stat">
                  <span className="stat-icon green">
                    <CheckCircle2 size={21} />
                  </span>
                  <div>
                    <span>Completed campaigns</span>
                    <strong>
                      {campaigns
                        .filter((c) => c.status === "complete")
                        .length.toString()
                        .padStart(2, "0")}
                    </strong>
                  </div>
                  <small>Review individual sending results</small>
                </div>
              </div>
              {view === "dashboard" && (
                <section className="intro-card">
                  <div>
                    <span className="pill">FROM TRAINING TO INBOX</span>
                    <h2>
                      A thoughtful send-off,
                      <br />
                      without the repetitive work.
                    </h2>
                    <p>
                      Upload signed certificates, match your participants,
                      <br className="desktop" /> and send a personalized email
                      to every learner.
                    </p>
                    <button onClick={create}>
                      Let’s create your first campaign <ArrowRight size={17} />
                    </button>
                  </div>
                  <div className="workflow-mini">
                    {[
                      {
                        n: "01",
                        icon: Upload,
                        title: "Upload",
                        text: "Certificates + participant list",
                      },
                      {
                        n: "02",
                        icon: Palette,
                        title: "Make it yours",
                        text: "Your message, beautifully delivered",
                      },
                      {
                        n: "03",
                        icon: Send,
                        title: "Send with confidence",
                        text: "Review every match before sending",
                      },
                    ].map((x) => (
                      <div key={x.n}>
                        <span className="mini-number">{x.n}</span>
                        <x.icon size={21} />
                        <span>
                          <strong>{x.title}</strong>
                          <small>{x.text}</small>
                        </span>
                        {x.n !== "03" && <div className="mini-line" />}
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <section className="panel campaigns-panel">
                <div className="section-heading">
                  <div>
                    <h2>
                      {view === "dashboard"
                        ? "Recent campaigns"
                        : "All campaigns"}
                    </h2>
                    <p>One place for every training and every certificate.</p>
                  </div>
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Search campaigns"
                      placeholder="Search campaigns…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>CAMPAIGN</th>
                        <th>PARTICIPANTS</th>
                        <th>STATUS</th>
                        <th>CREATED</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns
                        .filter((c) =>
                          c.title.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((c) => (
                          <tr key={c.id}>
                            <td>
                              <button
                                className="campaign-link"
                                onClick={() => open(c)}
                              >
                                <span className="file-icon">
                                  <Award size={20} />
                                </span>
                                <span>
                                  {c.title}
                                  <small>{c.organizer}</small>
                                </span>
                              </button>
                            </td>
                            <td>
                              {c.recipients.filter((r) => !r.excluded).length}
                            </td>
                            <td>
                              <span className={"status " + c.status}>
                                {c.status}
                              </span>
                            </td>
                            <td>
                              {new Date(
                                c.created_at || Date.now(),
                              ).toLocaleDateString("en-PH", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={"Open " + c.title}
                                onClick={() => open(c)}
                              >
                                <ArrowRight size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {campaigns.length === 0 && (
                  <div className="empty">
                    <span className="empty-icon">
                      <FolderOpen size={28} />
                    </span>
                    <h3>Your next training starts here</h3>
                    <p>
                      Create a campaign to bring your certificates,
                      <br />
                      participants, and message together.
                    </p>
                    <button className="secondary" onClick={create}>
                      <Plus size={16} />
                      Create your first campaign
                    </button>
                  </div>
                )}
              </section>
              <div className="footer-note">
                <ShieldCheck size={15} />
                Private certificates. Personalized messages. A little less
                admin.
              </div>
            </>
          )}
          {view === "campaign" && campaign && (
            <>
              <div className="page-heading compact">
                <div>
                  <button
                    className="back-link"
                    onClick={() => setView("campaigns")}
                  >
                    <ArrowLeft size={15} />
                    All campaigns
                  </button>
                  <h1>{campaign.title}</h1>
                  <p>
                    {locked
                      ? "Follow each certificate from queue to SMTP acceptance."
                      : "A little preparation. A meaningful moment for every participant."}
                  </p>
                </div>
                <div className="actions">
                  <span className={"status " + campaign.status}>
                    {campaign.status}
                  </span>
                  {!locked && (
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() =>
                        run("Saving draft", async () => {
                          await save();
                          await refresh();
                          setNotice("Draft saved.");
                        })
                      }
                    >
                      <Save size={16} />
                      Save draft
                    </button>
                  )}
                </div>
              </div>
              <div className="stepper">
                {steps.map((s, i) => (
                  <button
                    key={s}
                    disabled={!!locked && i !== 3}
                    className={step === i ? "current" : step > i ? "done" : ""}
                    onClick={() => setStep(i)}
                  >
                    <span>{step > i ? <Check size={15} /> : i + 1}</span>
                    {s}
                    {i < 3 && <ChevronRight size={16} />}
                  </button>
                ))}
              </div>
              {step === 0 && (
                <section className="panel form-panel">
                  <div className="section-heading">
                    <div>
                      <h2>Give this milestone a name</h2>
                      <p>
                        These details also personalize your participants’
                        emails.
                      </p>
                    </div>
                    <Award size={25} />
                  </div>
                  <div className="form-grid">
                    <label className="full">
                      Training title
                      <input
                        value={campaign.title}
                        onChange={(e) => patch({ title: e.target.value })}
                        placeholder="e.g. Digital Literacy Training"
                      />
                    </label>
                    <label>
                      Training date
                      <input
                        type="date"
                        value={campaign.date}
                        onChange={(e) => patch({ date: e.target.value })}
                      />
                    </label>
                    <label>
                      Organizer
                      <input
                        value={campaign.organizer}
                        onChange={(e) => patch({ organizer: e.target.value })}
                      />
                    </label>
                    <label className="full">
                      Delete campaign data after
                      <select
                        value={campaign.retention_days}
                        onChange={(e) =>
                          patch({ retention_days: Number(e.target.value) })
                        }
                      >
                        <option value={30}>30 days from creation</option>
                        <option value={90}>90 days from creation</option>
                        <option value={180}>180 days from creation</option>
                        <option value={365}>365 days from creation</option>
                      </select>
                      <small>
                        Removes certificates and participant records when the
                        campaign is no longer sending.
                      </small>
                    </label>
                  </div>
                  <div className="info-box">
                    <ShieldCheck size={20} />
                    <span>
                      This workspace sends training certificates. Use a
                      consent-aware mailing platform for promotional
                      newsletters.
                    </span>
                  </div>
                </section>
              )}
              {step === 1 && (
                <>
                  <div className="upload-grid">
                    <section className="panel upload-card">
                      <span className="stat-icon blue">
                        <FileText size={24} />
                      </span>
                      <h2>Signed certificates</h2>
                      <p>
                        Upload PDFs or a ZIP. Name each PDF after
                        <br />
                        the participant for automatic matching.
                      </p>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".pdf,.zip"
                        multiple
                        hidden
                        onChange={(e) => {
                          uploadFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() => fileRef.current?.click()}
                      >
                        <Upload size={16} />
                        Upload certificates
                      </button>
                      <small>PDFs up to 10 MB each · ZIP up to 50 MB</small>
                      <small>
                        Certificates are saved on this computer and remain
                        available after reopening the app.
                      </small>
                      <span className="upload-count">
                        {certificates.length} certificates saved locally
                      </span>
                    </section>
                    <section className="panel upload-card">
                      <span className="stat-icon green">
                        <Users size={24} />
                      </span>
                      <h2>Participant list</h2>
                      <p>
                        Import a CSV with names and email addresses.
                        <br />
                        You can map your columns before importing.
                      </p>
                      <input
                        ref={csvRef}
                        type="file"
                        accept=".csv"
                        hidden
                        onChange={(e) => {
                          readCsv(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                      <button
                        className="secondary"
                        onClick={() => csvRef.current?.click()}
                      >
                        <Upload size={16} />
                        Upload participant CSV
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          download(
                            "participant-template.csv",
                            "name,email,certificate_filename\r\nAlex Santos,alex@example.com,Alex Santos.pdf\r\nJamie Reyes,jamie@example.com,Jamie Reyes.pdf",
                          )
                        }
                      >
                        <Download size={14} />
                        Download CSV template
                      </button>
                      <span className="upload-count">
                        {campaign.recipients.length} participants imported
                      </span>
                    </section>
                  </div>
                  {csvRows.length > 0 && (
                    <section className="panel mapping">
                      <h3>Map your CSV columns</h3>
                      <p>
                        Importing replaces this draft’s current recipient list.
                      </p>
                      <div className="form-grid">
                        {(["name", "email", "filename"] as const).map((key) => (
                          <label key={key}>
                            {key === "filename"
                              ? "Certificate filename (optional)"
                              : key}
                            <select
                              value={columns[key]}
                              onChange={(e) =>
                                setColumns({
                                  ...columns,
                                  [key]: e.target.value,
                                })
                              }
                            >
                              <option value="">Select column</option>
                              {Object.keys(csvRows[0]).map((h) => (
                                <option key={h}>{h}</option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                      <button
                        className="primary"
                        disabled={!columns.name || !columns.email}
                        onClick={importCsv}
                      >
                        Import {csvRows.length} participants
                      </button>
                    </section>
                  )}
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>Make every match count</h2>
                        <p>
                          {active.length} included · {invalid} need attention ·{" "}
                          {campaign.recipients.length - active.length} excluded
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() =>
                          patch({
                            recipients: campaign.recipients.map((r) => ({
                              ...r,
                              certificate:
                                r.certificate ||
                                matchCertificate(r.name, "", certificates),
                            })),
                          })
                        }
                      >
                        <RotateCcw size={15} />
                        Match filenames
                      </button>
                    </div>
                    <div className="table-wrap">
                      <table className="recipient-table">
                        <thead>
                          <tr>
                            <th>INCLUDE</th>
                            <th>PARTICIPANT</th>
                            <th>EMAIL ADDRESS</th>
                            <th>CERTIFICATE</th>
                            <th>REVIEW</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaign.recipients.map((r) => (
                            <tr
                              key={r.id}
                              className={r.excluded ? "excluded" : ""}
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={"Include " + r.name}
                                  checked={!r.excluded}
                                  onChange={(e) =>
                                    patch({
                                      recipients: campaign.recipients.map(
                                        (x) =>
                                          x.id === r.id
                                            ? {
                                                ...x,
                                                excluded: !e.target.checked,
                                              }
                                            : x,
                                      ),
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  aria-label="Participant name"
                                  value={r.name}
                                  onChange={(e) =>
                                    patch({
                                      recipients: campaign.recipients.map(
                                        (x) =>
                                          x.id === r.id
                                            ? { ...x, name: e.target.value }
                                            : x,
                                      ),
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={"Email for " + r.name}
                                  value={r.email}
                                  onChange={(e) =>
                                    patch({
                                      recipients: campaign.recipients.map(
                                        (x) =>
                                          x.id === r.id
                                            ? { ...x, email: e.target.value }
                                            : x,
                                      ),
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <div className="certificate-select">
                                  <select
                                    aria-label={"Certificate for " + r.name}
                                    value={r.certificate || ""}
                                    onChange={(e) =>
                                      patch({
                                        recipients: campaign.recipients.map(
                                          (x) =>
                                            x.id === r.id
                                              ? {
                                                  ...x,
                                                  certificate:
                                                    e.target.value || null,
                                                }
                                              : x,
                                        ),
                                      })
                                    }
                                  >
                                    <option value="">Select certificate</option>
                                    {certificates.map((f) => (
                                      <option key={f.id} value={f.id}>
                                        {f.name}
                                      </option>
                                    ))}
                                  </select>
                                  {r.certificate && (
                                    <button
                                      className="icon-button"
                                      aria-label={
                                        "Preview certificate for " + r.name
                                      }
                                      onClick={() =>
                                        window.open(
                                          `/api/certificate?id=${r.certificate}`,
                                          "_blank",
                                          "noopener,noreferrer",
                                        )
                                      }
                                    >
                                      <Eye size={16} />
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td>
                                <span
                                  className={
                                    "match-status " +
                                    (problems.get(r.id) ? "warning" : "")
                                  }
                                >
                                  {r.excluded
                                    ? "Excluded"
                                    : problems.get(r.id) || "Matched"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!campaign.recipients.length && (
                      <div className="empty small">
                        <Users size={26} />
                        <h3>A place for every participant</h3>
                        <p>
                          Upload your CSV to review names, emails, and
                          certificate matches.
                        </p>
                      </div>
                    )}
                  </section>
                </>
              )}
              {step === 2 && (
                <>
                  <div className="editor-meta panel">
                    <label>
                      Subject line
                      <input
                        value={campaign.subject}
                        onChange={(e) => patch({ subject: e.target.value })}
                      />
                    </label>
                    <label>
                      Preview text
                      <input
                        value={campaign.preheader}
                        onChange={(e) => patch({ preheader: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="editor-grid">
                    <section className="panel editor-controls">
                      <h3>Make it yours</h3>
                      <div className="form-grid">
                        <label>
                          Accent color
                          <div className="color-input">
                            <input
                              type="color"
                              value={campaign.design.color}
                              onChange={(e) =>
                                design({ color: e.target.value })
                              }
                            />
                            <span>{campaign.design.color}</span>
                          </div>
                        </label>
                        <label className="full">
                          Font
                          <select
                            value={campaign.design.font}
                            onChange={(e) =>
                              design({ font: e.target.value as Design["font"] })
                            }
                          >
                            {[
                              "Arial",
                              "Georgia",
                              "Verdana",
                              "Trebuchet MS",
                            ].map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Alignment
                          <select
                            value={campaign.design.align}
                            onChange={(e) =>
                              design({
                                align: e.target.value as Design["align"],
                              })
                            }
                          >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                          </select>
                        </label>
                        <label>
                          Padding
                          <select
                            value={campaign.design.spacing}
                            onChange={(e) =>
                              design({ spacing: Number(e.target.value) })
                            }
                          >
                            {[16, 24, 32, 40, 48].map((x) => (
                              <option key={x} value={x}>
                                {x}px
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="control-divider" />
                      <h3>Content blocks</h3>
                      <div className="block-tools">
                        {[
                          { type: "heading", icon: Type, label: "Heading" },
                          { type: "text", icon: FileText, label: "Text" },
                          {
                            type: "button",
                            icon: MousePointer2,
                            label: "Button",
                          },
                          { type: "image", icon: ImageIcon, label: "Image" },
                          { type: "divider", icon: Minus, label: "Divider" },
                        ].map((x) => (
                          <button
                            key={x.type}
                            title={"Add " + x.label}
                            onClick={() =>
                              addBlock(
                                x.type as Design["blocks"][number]["type"],
                              )
                            }
                          >
                            <x.icon size={16} />
                            {x.label}
                          </button>
                        ))}
                      </div>
                      <div className="blocks">
                        {campaign.design.blocks.map((b, i) => (
                          <div
                            key={b.id}
                            className={
                              "block-row " +
                              (b.id === selectedBlock ? "selected" : "")
                            }
                            draggable
                            onDragStart={() => (drag.current = i)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (drag.current === null) return;
                              const blocks = [...campaign.design.blocks];
                              const [item] = blocks.splice(drag.current, 1);
                              blocks.splice(i, 0, item);
                              design({ blocks });
                              drag.current = null;
                            }}
                          >
                            <GripVertical size={15} />
                            <button onClick={() => setSelectedBlock(b.id)}>
                              {b.type}
                              <small>{b.text.slice(0, 28) || "—"}</small>
                            </button>
                            <button
                              className="icon-button"
                              title="Move block up"
                              disabled={i === 0}
                              onClick={() => {
                                const blocks = [...campaign.design.blocks];
                                [blocks[i - 1], blocks[i]] = [
                                  blocks[i],
                                  blocks[i - 1],
                                ];
                                design({ blocks });
                              }}
                            >
                              ↑
                            </button>
                            <button
                              className="icon-button"
                              title="Delete block"
                              onClick={() =>
                                design({
                                  blocks: campaign.design.blocks.filter(
                                    (x) => x.id !== b.id,
                                  ),
                                })
                              }
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                      {block && block.type !== "divider" && (
                        <div className="block-edit">
                          <label>
                            {block.type === "image"
                              ? "Image alternative text"
                              : "Content"}
                            <textarea
                              rows={block.type === "text" ? 7 : 3}
                              value={block.text}
                              onChange={(e) =>
                                updateBlock({ text: e.target.value })
                              }
                            />
                          </label>
                          {["button", "image"].includes(block.type) && (
                            <label>
                              {block.type === "image"
                                ? "Public image URL"
                                : "Button URL"}
                              <input
                                type="url"
                                placeholder="https://…"
                                value={block.url}
                                onChange={(e) =>
                                  updateBlock({ url: e.target.value })
                                }
                              />
                              <small>
                                HTTPS links only. Images must be publicly
                                hosted.
                              </small>
                            </label>
                          )}
                          <small>
                            Personalize with {"{{name}}"},{" "}
                            {"{{training_title}}"}, {"{{training_date}}"}, or{" "}
                            {"{{organizer}}"}.
                          </small>
                        </div>
                      )}
                      <div className="control-divider" />
                      <label>
                        Save as a reusable template
                        <input
                          placeholder="Template name"
                          value={templateName}
                          onChange={(e) => setTemplateName(e.target.value)}
                        />
                      </label>
                      <button
                        className="secondary wide"
                        disabled={!templateName || !!busy}
                        onClick={() =>
                          run("Saving template", async () => {
                            await api("/api/workspace", {
                              action: "template",
                              name: templateName,
                              design: campaign.design,
                            });
                            await refresh();
                            setNotice("Template saved.");
                          })
                        }
                      >
                        <Copy size={15} />
                        Save template
                      </button>
                      {templates.length > 0 && (
                        <label>
                          Apply saved template
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              const t = templates.find(
                                (t) => t.id === e.target.value,
                              );
                              if (t) design(t.design);
                            }}
                          >
                            <option value="">Choose a template</option>
                            {templates.map((t) => (
                              <option value={t.id} key={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </section>
                    <section className="panel preview-panel">
                      <div className="preview-toolbar">
                        <span>
                          <Eye size={16} />
                          Email preview
                        </span>
                        <div>
                          <button
                            className={
                              "icon-button " + (!mobile ? "selected" : "")
                            }
                            aria-label="Desktop preview"
                            onClick={() => setMobile(false)}
                          >
                            <Monitor size={18} />
                          </button>
                          <button
                            className={
                              "icon-button " + (mobile ? "selected" : "")
                            }
                            aria-label="Mobile preview"
                            onClick={() => setMobile(true)}
                          >
                            <Smartphone size={18} />
                          </button>
                        </div>
                      </div>
                      <label className="preview-recipient">
                        Preview as
                        <select
                          value={previewName}
                          onChange={(e) => setPreviewName(e.target.value)}
                        >
                          <option>Training participant</option>
                          {active.map((r) => (
                            <option key={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </label>
                      <div
                        className="preview-canvas"
                        style={{ background: "#ffffff" }}
                      >
                        <iframe
                          title="Personalized email preview"
                          sandbox=""
                          srcDoc={renderEmail(campaign, previewName).html}
                          style={{ maxWidth: mobile ? 375 : "100%" }}
                        />
                      </div>
                      <div className="attachment-note">
                        <FileText size={18} />
                        <span>
                          Participant’s signed certificate.pdf
                          <small>Attached individually when sent</small>
                        </span>
                        <ShieldCheck size={18} />
                      </div>
                    </section>
                  </div>
                </>
              )}
              {step === 3 && (
                <>
                  <div className="review-grid">
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>
                            {locked
                              ? "Campaign progress"
                              : "One last look before it lands"}
                          </h2>
                          <p>
                            {locked
                              ? "SMTP acceptance means the provider received the email, not confirmed inbox delivery."
                              : "Check your message, matches, and sender before launching."}
                          </p>
                        </div>
                        <Send size={24} />
                      </div>
                      <div className="review-content">
                        <div className="review-count">
                          <strong>
                            {locked ? accepted : active.length}
                            <span> / {active.length}</span>
                          </strong>
                          <span>
                            {locked
                              ? "accepted by SMTP"
                              : "participants ready for review"}
                          </span>
                        </div>
                        {locked && (
                          <progress max={active.length || 1} value={accepted} />
                        )}
                        <dl>
                          <dt>Sender</dt>
                          <dd>{sender.email || "Not configured"}</dd>
                          <dt>Subject</dt>
                          <dd>{campaign.subject}</dd>
                          <dt>Certificate matches</dt>
                          <dd>
                            {invalid
                              ? `${invalid} require attention`
                              : "All included recipients matched"}
                          </dd>
                          <dt>Attachments</dt>
                          <dd>One signed PDF per participant</dd>
                          <dt>Sending pace</dt>
                          <dd>
                            Up to {sender.per_minute} emails/minute ·{" "}
                            {sender.daily_limit}/24 hours
                          </dd>
                        </dl>
                        {!locked && (
                          <>
                            <button
                              className="secondary"
                              disabled={!!busy || !sender.verified}
                              onClick={() =>
                                run("Sending test email", async () => {
                                  await save();
                                  await api("/api/workspace", {
                                    action: "test",
                                    id: campaign.id,
                                  });
                                  setNotice(
                                    `Test submitted to ${sender.email}. Verify its message and attachment before launching.`,
                                  );
                                })
                              }
                            >
                              <Mail size={16} />
                              Send test to my inbox
                            </button>
                            <p className="muted">
                              The test uses the first included participant and
                              goes only to your sender email.
                            </p>
                          </>
                        )}
                      </div>
                    </section>
                    <section className="panel send-card">
                      <ShieldCheck size={35} />
                      <h2>
                        {locked
                          ? "Every send, accounted for."
                          : "Ready when you are."}
                      </h2>
                      <p>
                        {locked
                          ? "You can pause pending emails and retry confirmed failures. Uncertain results require checking your provider’s records."
                          : "Your certificates are private. Each email is personalized. Sending continues while the local app is running."}
                      </p>
                      {!locked ? (
                        <button
                          className="primary wide"
                          disabled={
                            !!busy ||
                            invalid > 0 ||
                            !active.length ||
                            !sender.verified
                          }
                          onClick={() => setConfirm(true)}
                        >
                          <Send size={16} />
                          Review & launch campaign
                        </button>
                      ) : (
                        <div className="stack">
                          {campaign.status === "sending" ? (
                            <button
                              className="secondary"
                              disabled={!!busy}
                              onClick={() => action("pause")}
                            >
                              <Pause size={16} />
                              Pause pending emails
                            </button>
                          ) : (
                            campaign.status === "paused" && (
                              <button
                                className="primary"
                                disabled={!!busy}
                                onClick={() => action("launch")}
                              >
                                <Send size={16} />
                                Resume sending
                              </button>
                            )
                          )}
                          <button
                            className="secondary"
                            disabled={
                              !!busy || !jobs.some((j) => j.status === "failed")
                            }
                            onClick={() => action("retry")}
                          >
                            <RotateCcw size={16} />
                            Retry failed recipients
                          </button>
                        </div>
                      )}
                      {!sender.verified && !locked && (
                        <button
                          className="text-button"
                          onClick={() => setView("settings")}
                        >
                          Connect your sender first <ArrowRight size={14} />
                        </button>
                      )}
                    </section>
                  </div>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>Recipient results</h2>
                      <button
                        className="secondary"
                        onClick={() =>
                          download(
                            "campaign-results.csv",
                            [
                              "name,email,certificate,status,attempts,error",
                              ...campaign.recipients.map((r) => {
                                const j = jobs.find(
                                  (j) => j.recipient_id === r.id,
                                );
                                return [
                                  r.name,
                                  r.email,
                                  certificates.find(
                                    (c) => c.id === r.certificate,
                                  )?.name || "",
                                  r.excluded
                                    ? "excluded"
                                    : j?.status || "draft",
                                  String(j?.attempts || 0),
                                  j?.error || "",
                                ]
                                  .map(csvCell)
                                  .join(",");
                              }),
                            ].join("\r\n"),
                          )
                        }
                      >
                        <Download size={16} />
                        Export report
                      </button>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>PARTICIPANT</th>
                            <th>EMAIL</th>
                            <th>STATUS</th>
                            <th>DETAILS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaign.recipients.map((r) => {
                            const j = jobs.find((j) => j.recipient_id === r.id);
                            return (
                              <tr key={r.id}>
                                <td>{r.name}</td>
                                <td>{r.email}</td>
                                <td>
                                  <span
                                    className={
                                      "status " + (j?.status || "draft")
                                    }
                                  >
                                    {r.excluded
                                      ? "excluded"
                                      : j?.status || "draft"}
                                  </span>
                                </td>
                                <td>
                                  {j?.error ||
                                    (j?.accepted_at
                                      ? new Date(j.accepted_at).toLocaleString()
                                      : "—")}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              <div className="wizard-footer">
                <button
                  className="secondary"
                  disabled={step === 0 || !!locked}
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={16} />
                  Back
                </button>
                <span>Changes are saved when you click Save draft.</span>
                {step < 3 ? (
                  <button className="primary" onClick={() => setStep(step + 1)}>
                    Continue <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    className="text-button danger"
                    disabled={!!busy || campaign.status === "sending"}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Permanently delete this campaign, its certificates, and participant data?",
                        )
                      )
                        run("Deleting campaign", async () => {
                          await api("/api/workspace", {
                            action: "delete",
                            id: campaign.id,
                          });
                          setCampaign(null);
                          setView("campaigns");
                          await refresh();
                        });
                    }}
                  >
                    <Trash2 size={15} />
                    Delete campaign
                  </button>
                )}
              </div>
            </>
          )}
          <div hidden={view !== "tagger"}>
            <CertificateTagger />
          </div>
          <div hidden={view !== "analysis"}>
            <DataAnalysis />
          </div>
          {view === "templates" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR MESSAGE, YOUR WAY</div>
                  <h1>A head start on every send.</h1>
                  <p>
                    Reuse a design, then make it right for your next training.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    create();
                    setStep(2);
                  }}
                >
                  <Plus size={17} />
                  Design a template
                </button>
              </div>
              <div className="template-grid">
                {[
                  {
                    id: "default",
                    name: "The DICT milestone",
                    design: newCampaign().design,
                  },
                  ...templates,
                ].map((t) => (
                  <section className="panel template-card" key={t.id}>
                    <iframe
                      title={t.name + " preview"}
                      sandbox=""
                      srcDoc={
                        renderEmail(
                          {
                            ...newCampaign(),
                            title: "Digital Literacy Training",
                            design: t.design,
                          },
                          "Alex",
                        ).html
                      }
                    />
                    <div>
                      <h3>{t.name}</h3>
                      <p>
                        {t.id === "default"
                          ? "A warm, professional certificate email."
                          : "Saved to your workspace."}
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          const c = newCampaign();
                          c.design = structuredClone(t.design);
                          setCampaign(c);
                          setCertificates([]);
                          setJobs([]);
                          setStep(2);
                          setView("campaign");
                        }}
                      >
                        Use template <ArrowRight size={15} />
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
          {view === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">THE DETAILS BEHIND EVERY SEND</div>
                  <h1>Workspace settings</h1>
                  <p>Connect your sender and set a comfortable sending pace.</p>
                </div>
              </div>
              <section className="panel setup-instructions">
                <h2>Send from your email account</h2>
                <p>
                  No workspace account or cloud setup is needed. Enter your SMTP
                  details and app password below. Certificates, campaign
                  history, and encrypted sender settings stay on this computer.
                </p>
              </section>
              <section className="panel form-panel">
                <div className="section-heading">
                  <div>
                    <h2>Email sender</h2>
                    <p>
                      Your app password is encrypted and saved on this computer.
                    </p>
                  </div>
                  <span
                    className={
                      "status " + (sender.verified ? "accepted" : "draft")
                    }
                  >
                    {sender.verified ? "Connected" : "Not connected"}
                  </span>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run("Testing SMTP connection", async () => {
                      await api("/api/workspace", {
                        action: "smtp",
                        settings: sender,
                      });
                      setSender({ ...sender, password: "", verified: true });
                      setNotice("Connection verified. Sender settings saved.");
                    });
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Sender name
                      <input
                        required
                        value={sender.sender_name}
                        onChange={(e) =>
                          setSender({ ...sender, sender_name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Sender email
                      <input
                        required
                        type="email"
                        value={sender.email}
                        onChange={(e) =>
                          setSender({ ...sender, email: e.target.value })
                        }
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      SMTP host
                      <input
                        required
                        value={sender.host}
                        onChange={(e) =>
                          setSender({ ...sender, host: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Port
                      <select
                        value={sender.port}
                        onChange={(e) =>
                          setSender({ ...sender, port: Number(e.target.value) })
                        }
                      >
                        <option value={465}>465 · TLS</option>
                        <option value={587}>587 · STARTTLS</option>
                      </select>
                    </label>
                    <label className="full">
                      App password
                      <input
                        type="password"
                        value={sender.password}
                        onChange={(e) =>
                          setSender({ ...sender, password: e.target.value })
                        }
                        placeholder={
                          sender.verified
                            ? "Leave blank to keep the saved password"
                            : "Enter your provider’s app password"
                        }
                        autoComplete="new-password"
                      />
                      <small>
                        For Gmail, enable 2-Step Verification, then generate an
                        app password. Availability depends on your account
                        policy.
                      </small>
                    </label>
                    <label>
                      Emails per minute
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={sender.per_minute}
                        onChange={(e) =>
                          setSender({
                            ...sender,
                            per_minute: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Maximum per 24 hours
                      <input
                        type="number"
                        min={1}
                        max={2000}
                        value={sender.daily_limit}
                        onChange={(e) =>
                          setSender({
                            ...sender,
                            daily_limit: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="info-box">
                    <ShieldCheck size={20} />
                    <span>
                      Choose limits below your email provider’s quota.
                      Connection testing verifies credentials without sending an
                      email.
                    </span>
                  </div>
                  <button className="primary" disabled={!!busy}>
                    <ShieldCheck size={17} />
                    Test connection & save
                  </button>
                </form>
              </section>
            </>
          )}
        </main>
      </div>
      {confirm && campaign && (
        <div className="modal-backdrop">
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <button
              className="close-modal icon-button"
              aria-label="Close confirmation"
              onClick={() => setConfirm(false)}
            >
              <X size={20} />
            </button>
            <span className="stat-icon blue">
              <Send size={24} />
            </span>
            <h2 id="confirm-title">Send {active.length} certificates?</h2>
            <p>
              This will queue real emails from <strong>{sender.email}</strong>.
            </p>
            <dl>
              <dt>Subject</dt>
              <dd>{campaign.subject}</dd>
              <dt>Attachments</dt>
              <dd>{active.length} individually matched PDFs</dd>
              <dt>Unresolved issues</dt>
              <dd>{invalid}</dd>
            </dl>
            <p>
              Confirm you have reviewed the participant matches and test email.
              You can pause pending sends after launch.
            </p>
            <div className="actions">
              <button className="secondary" onClick={() => setConfirm(false)}>
                Keep reviewing
              </button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  run("Queuing certificates", async () => {
                    await save();
                    await api("/api/workspace", {
                      action: "launch",
                      id: campaign.id,
                    });
                    setConfirm(false);
                    const data = await api("/api/workspace?id=" + campaign.id);
                    setCampaign(data.campaign);
                    setJobs(data.jobs);
                    setNotice(
                      "Campaign queued. Sending will begin on the next worker cycle.",
                    );
                  })
                }
              >
                <Send size={16} />
                Confirm & send
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
