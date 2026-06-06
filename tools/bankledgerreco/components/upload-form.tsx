"use client";

/* Upload form for Bank Ledger Reconciliation — same layout + primitives as
   the Org Ledger Reconciliation tool:
     Step 1 — paired description cards + dropzones (Bank statement / Books),
              plus an optional Razorpay settlement dropzone
     Step 2 — full-width "Reconcile Now" CTA + hint

   Drag-and-drop with click-to-browse fallback. Uploads to Supabase Storage,
   inserts uploads rows, then submits the upload IDs to the server action,
   which triggers the Trigger.dev job and redirects to ?jobId. */

import { useState, useRef, useTransition, type DragEvent } from "react";
import { Button } from "../../../core/ui/button";
import { JobProgress } from "../../../core/ui/job-progress";
import { runBankReconcileAction } from "../run-action";

type UploadStage = "idle" | "uploading" | "submitting";

const ACCEPT_DATA = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";
const ACCEPT_PDF = `${ACCEPT_DATA},.pdf,application/pdf`;
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

type Props = { userId: string; toolId: string };

export function UploadForm(_props: Props) {
  const [bankFiles, setBankFiles] = useState<File[]>([]);
  const [booksFiles, setBooksFiles] = useState<File[]>([]);
  const [settlementFiles, setSettlementFiles] = useState<File[]>([]);
  const [dateWindowDays, setDateWindowDays] = useState(3);
  const [feeCeilingPct, setFeeCeilingPct] = useState(3);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [uploadPct, setUploadPct] = useState(0);
  const [, startTransition] = useTransition();

  async function uploadOne(file: File, kind: "bank" | "books" | "settlement", idx: number, total: number): Promise<string> {
    if (file.size > MAX_BYTES) {
      throw new Error(`${file.name} is larger than 50 MB — please trim the file before uploading.`);
    }
    const label = kind === "bank" ? "bank statement" : kind === "books" ? "books ledger" : "settlement report";
    setProgress(`Uploading ${label} — file ${idx} of ${total} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);

    const fd = new FormData();
    fd.set("file", file);
    fd.set("toolSlug", "bankledgerreco");
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
    if (!bankFiles.length || !booksFiles.length) {
      setError("Please attach at least one bank statement and one books ledger.");
      return;
    }
    try {
      setStage("uploading");
      setUploadPct(4);
      const queue: { file: File; kind: "bank" | "books" | "settlement" }[] = [
        ...bankFiles.map((file) => ({ file, kind: "bank" as const })),
        ...booksFiles.map((file) => ({ file, kind: "books" as const })),
        ...settlementFiles.map((file) => ({ file, kind: "settlement" as const })),
      ];
      const ids: Record<"bank" | "books" | "settlement", string[]> = { bank: [], books: [], settlement: [] };
      for (let i = 0; i < queue.length; i++) {
        const { file, kind } = queue[i];
        ids[kind].push(await uploadOne(file, kind, i + 1, queue.length));
        setUploadPct(Math.round(((i + 1) / queue.length) * 90));
      }

      setStage("submitting");
      setProgress("Starting reconciliation…");
      setUploadPct(95);
      const fd = new FormData();
      ids.bank.forEach((id) => fd.append("bankUploadId", id));
      ids.books.forEach((id) => fd.append("booksUploadId", id));
      ids.settlement.forEach((id) => fd.append("settlementUploadId", id));
      fd.set("dateWindowDays", String(dateWindowDays));
      fd.set("feeCeilingPct", String(feeCeilingPct));

      startTransition(async () => {
        try {
          await runBankReconcileAction(fd);
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
  const ready = bankFiles.length > 0 && booksFiles.length > 0 && !busy;

  // While uploading / starting, replace the form with the calm progress card —
  // the result view then continues the same bar through queued → running → report.
  if (busy) {
    return <JobProgress stage="uploading" detail={progress} pct={uploadPct} />;
  }

  return (
    <form onSubmit={onSubmit}>
      {/* ── Banner — pinned dark; navy bg in both themes ─────────── */}
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
          <span style={{ fontSize: 22 }}>🏦</span> Bank Ledger Reconciliation
        </div>
        <div style={{
          fontSize: 13,
          color: "var(--text-on-banner-muted)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.01em",
        }}>
          Upload bank statement + books → Click Reconcile → Download exceptions
        </div>
      </div>

      {/* ── Step 1 — Upload ────────────────────────────────────── */}
      <StepLabel>Step 1 — Upload Statement &amp; Ledger</StepLabel>

      {/* Description cards row */}
      <div style={gridTwo}>
        <DescCard
          icon="🏦"
          title="Your Bank Statement"
          accent="var(--bg-banner-start)"
          body="Export the account statement from your bank's portal. We auto-detect the date, narration, debit and credit columns. Excel, CSV and PDF supported — add several files (e.g. one per month) and we merge them into one statement."
        />
        <DescCard
          icon="📒"
          title="Your Books Ledger"
          accent="var(--bg-banner-start)"
          body="Upload the same bank account's ledger from your ERP (Business Central / Tally / Zoho). Excel, CSV or PDF — multiple files are merged."
        />
      </div>

      {/* Dropzone row */}
      <div style={{ ...gridTwo, marginTop: 18 }}>
        <Dropzone label="Upload Your Bank Statement" hint="One or more files · 50 MB each · XLSX, CSV, PDF" accept={ACCEPT_PDF} files={bankFiles} onFiles={setBankFiles} disabled={busy} />
        <Dropzone label="Upload Your Books Ledger" hint="One or more files · 50 MB each · XLSX, CSV, PDF" accept={ACCEPT_PDF} files={booksFiles} onFiles={setBooksFiles} disabled={busy} />
      </div>

      {/* Optional settlement — full width */}
      <div style={{ marginTop: 18 }}>
        <DescCard
          icon="💳"
          title="Razorpay Settlement Report (optional)"
          accent="var(--bg-banner-start)"
          body="Add Razorpay's settlement export for exact gateway fee + GST reconciliation. Skip it and we'll infer the fee from the amounts."
        />
        <div style={{ marginTop: 14 }}>
          <Dropzone label="Upload Razorpay Settlement Report — optional" hint="One or more files · 50 MB each · XLSX, CSV" accept={ACCEPT_DATA} files={settlementFiles} onFiles={setSettlementFiles} disabled={busy} />
        </div>
      </div>

      {/* ── Step 2 — Run ───────────────────────────────────────── */}
      <div style={{ marginTop: 36, borderTop: "1px solid var(--line)", paddingTop: 28 }}>
        <StepLabel>Step 2 — Run Reconciliation</StepLabel>

        {/* Matching settings */}
        <div style={{
          display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center",
          marginBottom: 18, padding: "14px 18px",
          background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: 10,
        }}>
          <SettingNum
            label="Date tolerance (days)"
            hint="posting / settlement lag"
            value={dateWindowDays} min={0} max={15} step={1}
            onChange={setDateWindowDays} disabled={busy}
          />
          <SettingNum
            label="Max gateway fee (%)"
            hint="Razorpay / POS fee ceiling"
            value={feeCeilingPct} min={0} max={10} step={0.5}
            onChange={setFeeCeilingPct} disabled={busy}
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
            ↑ Please upload your bank statement and books ledger above, then click Reconcile.
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

      {/* ── Footer hint ────────────────────────────────────────── */}
      <div style={{
        marginTop: 28, textAlign: "center", fontSize: 11.5,
        color: "var(--ink-400)", fontFamily: "var(--font-mono)", letterSpacing: "0.03em",
      }}>
        Bank Ledger Reconciliation · Handles UPI day-aggregation, Razorpay/POS fees, posting-date lag, bank charges &amp; reversals
      </div>
    </form>
  );
}

// ── Primitives (identical to orgledgerreco) ─────────────────────────────────

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
          width: 64, padding: "6px 10px", borderRadius: 8,
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

  // Append new files, skipping ones already attached (same name + size).
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
