"use client";

/* Upload form for GST Ledger Reconciliation — same visual language as
   bank/org Ledger Reconciliation:

     Step 1 — ITC pair: GSTR-2B (required) + Purchase Register (required)
     Step 2 — Sales pair (optional): GSTR-1 + Sales Register
     Step 3 — Optional: GSTR-2A for "filed but past the 2B cutoff" visibility
     Step 4 — Settings + full-width "Reconcile Now" CTA

   Drag-and-drop with click-to-browse fallback. Uploads to Supabase
   Storage via /api/uploads (which inserts an uploads row), then submits
   the upload IDs to runGstReconcileAction, which triggers the Trigger.dev
   job and redirects to ?jobId. */

import { useState, useRef, useTransition, type DragEvent } from "react";
import { Button } from "../../../core/ui/button";
import { JobProgress } from "../../../core/ui/job-progress";
import { runGstReconcileAction } from "../run-action";

type UploadStage = "idle" | "uploading" | "submitting";

type UploadKind = "gstr1" | "gstr2a" | "gstr2b" | "sales" | "purchase";

const ACCEPT_REGISTER = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";
const ACCEPT_PORTAL = `${ACCEPT_REGISTER},.json,application/json`;
const MAX_BYTES = 50 * 1024 * 1024;

type Props = { userId: string; toolId: string };

export function UploadForm(_props: Props) {
  const [gstr2bFiles, setGstr2bFiles] = useState<File[]>([]);
  const [purchaseFiles, setPurchaseFiles] = useState<File[]>([]);
  const [gstr1Files, setGstr1Files] = useState<File[]>([]);
  const [salesFiles, setSalesFiles] = useState<File[]>([]);
  const [gstr2aFiles, setGstr2aFiles] = useState<File[]>([]);

  const [dateWindowDays, setDateWindowDays] = useState(7);
  const [amountToleranceRupees, setAmountToleranceRupees] = useState(1);

  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [uploadPct, setUploadPct] = useState(0);
  const [, startTransition] = useTransition();

  async function uploadOne(file: File, kind: UploadKind, idx: number, total: number): Promise<string> {
    if (file.size > MAX_BYTES) {
      throw new Error(`${file.name} is larger than 50 MB — please trim the file before uploading.`);
    }
    const label = KIND_LABEL[kind];
    setProgress(`Uploading ${label} — file ${idx} of ${total} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);

    const fd = new FormData();
    fd.set("file", file);
    fd.set("toolSlug", "gstledgerreco");
    fd.set("kind", kind);

    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!res.ok) {
      let msg = `Upload failed (HTTP ${res.status})`;
      try { const body = await res.json(); if (body?.error) msg = body.error; } catch {}
      throw new Error(msg);
    }
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!gstr2bFiles.length || !purchaseFiles.length) {
      setError("Please attach at least one GSTR-2B file and one Purchase Register.");
      return;
    }
    try {
      setStage("uploading");
      setUploadPct(4);
      const queue: { file: File; kind: UploadKind }[] = [
        ...gstr2bFiles.map((file) => ({ file, kind: "gstr2b" as const })),
        ...purchaseFiles.map((file) => ({ file, kind: "purchase" as const })),
        ...gstr1Files.map((file) => ({ file, kind: "gstr1" as const })),
        ...salesFiles.map((file) => ({ file, kind: "sales" as const })),
        ...gstr2aFiles.map((file) => ({ file, kind: "gstr2a" as const })),
      ];
      const ids: Record<UploadKind, string[]> = {
        gstr1: [], gstr2a: [], gstr2b: [], sales: [], purchase: [],
      };
      for (let i = 0; i < queue.length; i++) {
        const { file, kind } = queue[i];
        ids[kind].push(await uploadOne(file, kind, i + 1, queue.length));
        setUploadPct(Math.round(((i + 1) / queue.length) * 90));
      }

      setStage("submitting");
      setProgress("Starting reconciliation…");
      setUploadPct(95);
      const fd = new FormData();
      ids.gstr2b.forEach((id) => fd.append("gstr2bUploadId", id));
      ids.purchase.forEach((id) => fd.append("purchaseUploadId", id));
      ids.gstr1.forEach((id) => fd.append("gstr1UploadId", id));
      ids.sales.forEach((id) => fd.append("salesUploadId", id));
      ids.gstr2a.forEach((id) => fd.append("gstr2aUploadId", id));
      fd.set("dateWindowDays", String(dateWindowDays));
      fd.set("amountTolerancePaise", String(Math.round(amountToleranceRupees * 100)));

      startTransition(async () => {
        try {
          await runGstReconcileAction(fd);
        } catch (err) {
          setStage("idle");
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    } catch (err) {
      setStage("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const busy = stage !== "idle";
  const ready = gstr2bFiles.length > 0 && purchaseFiles.length > 0 && !busy;

  if (busy) {
    return <JobProgress stage="uploading" detail={progress} pct={uploadPct} />;
  }

  return (
    <form onSubmit={onSubmit}>
      {/* ── Banner ──────────────────────────────────────────────── */}
      <div
        data-theme="dark"
        style={{
          background: "linear-gradient(180deg, var(--bg-banner-start) 0%, var(--bg-banner-end) 100%)",
          border: "1px solid var(--line-strong)",
          borderRadius: "var(--radius-lg)",
          padding: "18px 22px",
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          color: "var(--text-on-banner)",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontWeight: 600, fontSize: 17 }}>
          <span style={{ fontSize: 22 }}>🧾</span> GST Ledger Reconciliation
        </div>
        <div style={{
          fontSize: 13,
          color: "var(--text-on-banner-muted)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.01em",
        }}>
          Upload GSTR-2B + Purchase Register → Click Reconcile → See ITC at risk
        </div>
      </div>

      {/* ── Step 1 — ITC pair (required) ────────────────────────── */}
      <StepLabel>Step 1 — ITC pair (required)</StepLabel>

      <div style={gridTwo}>
        <DescCard
          icon="🧾"
          title="GSTR-2B"
          accent="var(--bg-banner-start)"
          body="Download from the GST portal → Returns Dashboard → GSTR-2B → Download JSON (or Excel). 2B is the snapshot that defines eligible ITC for the period."
        />
        <DescCard
          icon="📒"
          title="Purchase Register"
          accent="var(--bg-banner-start)"
          body="Export the inward-supply register from Tally / Business Central / Zoho — invoice-level, with GSTIN, Invoice No, Date, Taxable Value and the IGST/CGST/SGST split. XLSX or CSV."
        />
      </div>

      <div style={{ ...gridTwo, marginTop: 18 }}>
        <Dropzone label="Upload GSTR-2B" hint="One or more files · 50 MB each · JSON, XLSX, CSV" accept={ACCEPT_PORTAL} files={gstr2bFiles} onFiles={setGstr2bFiles} disabled={busy} />
        <Dropzone label="Upload Purchase Register" hint="One or more files · 50 MB each · XLSX, CSV" accept={ACCEPT_REGISTER} files={purchaseFiles} onFiles={setPurchaseFiles} disabled={busy} />
      </div>

      {/* ── Step 2 — Sales pair (optional) ──────────────────────── */}
      <div style={{ marginTop: 36, borderTop: "1px solid var(--line)", paddingTop: 28 }}>
        <StepLabel>Step 2 — Sales pair (optional)</StepLabel>

        <div style={gridTwo}>
          <DescCard
            icon="📤"
            title="GSTR-1"
            accent="var(--bg-banner-start)"
            body="Your filed outward-supply return — download JSON or Excel from the portal. Skip this if you only want the ITC report."
          />
          <DescCard
            icon="📕"
            title="Sales Register"
            accent="var(--bg-banner-start)"
            body="Outward-supply ledger from your ERP. Compares against your filed GSTR-1 to catch short-filings."
          />
        </div>

        <div style={{ ...gridTwo, marginTop: 18 }}>
          <Dropzone label="Upload GSTR-1 — optional" hint="JSON, XLSX, CSV" accept={ACCEPT_PORTAL} files={gstr1Files} onFiles={setGstr1Files} disabled={busy} />
          <Dropzone label="Upload Sales Register — optional" hint="XLSX, CSV" accept={ACCEPT_REGISTER} files={salesFiles} onFiles={setSalesFiles} disabled={busy} />
        </div>
      </div>

      {/* ── Step 3 — GSTR-2A (optional) ─────────────────────────── */}
      <div style={{ marginTop: 36, borderTop: "1px solid var(--line)", paddingTop: 28 }}>
        <StepLabel>Step 3 — GSTR-2A (optional)</StepLabel>

        <DescCard
          icon="📥"
          title="GSTR-2A"
          accent="var(--bg-banner-start)"
          body="2A is dynamic — suppliers can file past the 2B cutoff and the invoice shows up in 2A only. Adding it lets us tell you which suppliers filed late."
        />
        <div style={{ marginTop: 14 }}>
          <Dropzone label="Upload GSTR-2A — optional" hint="One or more files · 50 MB each · JSON, XLSX, CSV" accept={ACCEPT_PORTAL} files={gstr2aFiles} onFiles={setGstr2aFiles} disabled={busy} />
        </div>
      </div>

      {/* ── Step 4 — Settings + Run ─────────────────────────────── */}
      <div style={{ marginTop: 36, borderTop: "1px solid var(--line)", paddingTop: 28 }}>
        <StepLabel>Step 4 — Run Reconciliation</StepLabel>

        <div style={{
          display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center",
          marginBottom: 18, padding: "14px 18px",
          background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: 10,
        }}>
          <SettingNum
            label="Date tolerance (days)"
            hint="for the invoice-date check"
            value={dateWindowDays} min={0} max={30} step={1}
            onChange={setDateWindowDays} disabled={busy}
          />
          <SettingNum
            label="Amount tolerance (₹)"
            hint="ignore differences ≤ this"
            value={amountToleranceRupees} min={0} max={100} step={1}
            onChange={setAmountToleranceRupees} disabled={busy}
          />
        </div>

        <button
          type="submit"
          disabled={!ready}
          style={{
            width: "100%",
            padding: "18px",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "0.02em",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--line-strong)",
            cursor: ready ? "pointer" : "not-allowed",
            background: ready
              ? "linear-gradient(180deg, var(--accent-grad-start) 0%, var(--accent-grad-end) 100%)"
              : "var(--bg-elev)",
            color: ready ? "var(--accent-fg)" : "var(--ink-400)",
            boxShadow: ready
              ? "0 0 0 1px rgba(255,255,255,0.18) inset, 0 10px 30px -10px rgba(46,168,255,0.45)"
              : "none",
            transition: "all .25s var(--ease)",
          }}>
          ▶  RECONCILE NOW
        </button>

        {!ready && !busy && !error && (
          <div style={{
            marginTop: 14, padding: "12px 16px",
            background: "var(--accent-bg-soft)", border: "1px solid var(--accent-border-soft)",
            borderRadius: 10, color: "var(--ink-200)", fontSize: 13,
          }}>
            ↑ Please upload GSTR-2B and your Purchase Register above, then click Reconcile.
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 14, color: "var(--error-fg)", padding: "12px 16px",
            border: "1px solid var(--error-border)", background: "var(--error-bg)",
            borderRadius: 10, fontSize: 13,
          }}>
            {error}
          </div>
        )}
      </div>

      <div style={{
        marginTop: 28, textAlign: "center", fontSize: 11.5,
        color: "var(--ink-400)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em",
      }}>
        GST Ledger Reconciliation · Surfaces every rupee of ITC at risk: missing in 2B · GSTIN mismatches · value &amp; tax diffs · filed-late suppliers
      </div>
    </form>
  );
}

// ── Primitives (mirrors bankledgerreco / orgledgerreco) ─────────────────────

const KIND_LABEL: Record<UploadKind, string> = {
  gstr1: "GSTR-1",
  gstr2a: "GSTR-2A",
  gstr2b: "GSTR-2B",
  sales: "Sales Register",
  purchase: "Purchase Register",
};

const gridTwo: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };

function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", margin: "0 0 16px", color: "var(--ink-100)" }}>
      {children}
    </h2>
  );
}

function DescCard({ icon, title, accent, body }: { icon: string; title: string; accent: string; body: string }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--line)",
      borderRadius: "var(--radius-lg)", padding: "22px 22px 20px", boxShadow: "var(--shadow-card)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 600, color: accent, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>{icon}</span> {title}
      </div>
      <div style={{ fontSize: 13.5, color: "var(--ink-300)", lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function SettingNum({ label, hint, value, min, max, step, onChange, disabled }: {
  label: string; hint: string; value: number; min: number; max: number; step: number;
  onChange: (n: number) => void; disabled: boolean;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink-200)" }}>
      <span>
        {label}
        <span style={{ display: "block", fontSize: 11, color: "var(--ink-400)", fontFamily: "var(--font-mono)" }}>{hint}</span>
      </span>
      <input
        type="number" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
        style={{
          width: 72, padding: "6px 10px", borderRadius: 8,
          border: "1px solid var(--line-strong)", background: "var(--bg-card)", color: "var(--ink-100)",
        }}
      />
    </label>
  );
}

function Dropzone({ label, hint, accept, files, onFiles, disabled }: {
  label: string; hint: string; accept: string; files: File[]; onFiles: (f: File[]) => void; disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  function addFiles(list: FileList | null | undefined) {
    if (!list || !list.length) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    onFiles(next);
  }
  function removeAt(idx: number) { onFiles(files.filter((_, i) => i !== idx)); }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setHover(false); if (disabled) return; addFiles(e.dataTransfer.files);
  }

  return (
    <div>
      <div style={{
        fontSize: 12, color: "var(--ink-400)", fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8,
      }}>{label}</div>

      <div
        onDragEnter={() => !disabled && setHover(true)}
        onDragLeave={() => setHover(false)}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setHover(true); }}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        style={{
          display: "flex", alignItems: "center", gap: 14, padding: "18px 18px",
          background: hover ? "var(--accent-bg-soft)" : "var(--bg-elev)",
          border: `1px dashed ${hover ? "var(--accent)" : "var(--line-strong)"}`,
          borderRadius: "var(--radius-md)", cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.65 : 1,
          transition: "background .15s var(--ease), border-color .15s var(--ease)",
        }}
      >
        <div style={{ fontSize: 26, color: "var(--accent)" }}>⬆</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {files.length ? (
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-100)" }}>
              ✓ {files.length} file{files.length > 1 ? "s" : ""} attached
              <span style={{ fontWeight: 400, color: "var(--ink-400)" }}> · click to add more</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-100)" }}>Drag and drop file(s) here</div>
              <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>{hint}</div>
            </>
          )}
        </div>
        <Button size="sm" type="button" variant="ghost"
          onClick={(e) => { e.stopPropagation(); if (!disabled) inputRef.current?.click(); }}>
          Browse files
        </Button>
        <input
          ref={inputRef} type="file" accept={accept} multiple disabled={disabled}
          onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }} style={{ display: "none" }}
        />
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${f.size}-${i}`} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "7px 10px",
              background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: 8,
              fontSize: 12.5, color: "var(--ink-100)",
            }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name}
              </span>
              <span style={{ color: "var(--ink-400)", fontSize: 11, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                {(f.size / 1024 / 1024).toFixed(2)} MB
              </span>
              {!disabled && (
                <button
                  type="button" aria-label={`Remove ${f.name}`}
                  onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                  style={{
                    flexShrink: 0, width: 22, height: 22, lineHeight: "20px", textAlign: "center",
                    borderRadius: 6, border: "1px solid var(--line-strong)", background: "transparent",
                    color: "var(--ink-300)", cursor: "pointer", fontSize: 15,
                  }}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
