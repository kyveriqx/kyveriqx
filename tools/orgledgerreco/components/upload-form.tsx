"use client";

/* Upload form for Org Ledger Reconciliation.

   Two-column layout:
     Step 1 — paired description cards + dropzones (Your Company / Partner)
     Step 2 — full-width "Reconcile Now" CTA + hint

   Drag-and-drop with click-to-browse fallback. Uploads to Supabase Storage,
   inserts uploads rows, then submits two upload IDs to the server action. */

import { useState, useRef, useTransition, type DragEvent } from "react";
import { Button } from "../../../core/ui/button";
import { runOrgReconcileAction } from "../run-action";

type UploadStage = "idle" | "uploading" | "submitting";

const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// Tool props are accepted for forward-compatibility but the actual upload is
// gated server-side (session cookie + service role), so they're advisory here.
type Props = { userId: string; toolId: string };

export function UploadForm(_props: Props) {
  const [companyFile, setCompanyFile] = useState<File | null>(null);
  const [partnerFile, setPartnerFile] = useState<File | null>(null);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [, startTransition] = useTransition();

  async function uploadOne(file: File, kind: "company" | "partner"): Promise<string> {
    if (file.size > MAX_BYTES) {
      throw new Error(`${file.name} is larger than 50 MB — please trim the file before uploading.`);
    }

    setProgress(`Uploading ${kind === "company" ? "your books" : "partner's books"} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);

    const fd = new FormData();
    fd.set("file", file);
    fd.set("toolSlug", "orgledgerreco");
    fd.set("kind", kind);

    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!res.ok) {
      let msg = `Upload failed (HTTP ${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {}
      throw new Error(msg);
    }
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!companyFile || !partnerFile) {
      setError("Please attach both files.");
      return;
    }
    try {
      setStage("uploading");
      const [companyUploadId, partnerUploadId] = await Promise.all([
        uploadOne(companyFile, "company"),
        uploadOne(partnerFile, "partner"),
      ]);

      setStage("submitting");
      setProgress("Starting reconciliation…");
      const fd = new FormData();
      fd.set("companyUploadId", companyUploadId);
      fd.set("partnerUploadId", partnerUploadId);

      startTransition(async () => {
        try {
          await runOrgReconcileAction(fd);
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
  const ready = !!companyFile && !!partnerFile && !busy;

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
          <span style={{ fontSize: 22 }}>📊</span> Org Ledger Reconciliation
        </div>
        <div style={{
          fontSize: 13,
          color: "var(--text-on-banner-muted)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.01em",
        }}>
          Upload both ledger files → Click Reconcile → Download Report
        </div>
      </div>

      {/* ── Step 1 — Upload ────────────────────────────────────── */}
      <StepLabel>Step 1 — Upload Ledger Files</StepLabel>

      {/* Description cards row */}
      <div style={gridTwo}>
        <DescCard
          icon="🏢"
          title="Your Company's Ledger"
          accent="var(--bg-banner-start)"
          body="Export the account ledger from your ERP (Business Central / Tally / SAP) and upload it here. Excel and CSV files supported."
        />
        <DescCard
          icon="🏭"
          title="Your Business Partner's Ledger"
          accent="var(--bg-banner-start)"
          body="Upload the ledger received from your business partner. It can have multiple sheets (one per location). Excel or CSV."
        />
      </div>

      {/* Dropzone row */}
      <div style={{ ...gridTwo, marginTop: 18 }}>
        <Dropzone
          label="Upload Your Company's Ledger"
          file={companyFile}
          onFile={setCompanyFile}
          disabled={busy}
        />
        <Dropzone
          label="Upload Your Business Partner's Ledger"
          file={partnerFile}
          onFile={setPartnerFile}
          disabled={busy}
        />
      </div>

      {/* ── Step 2 — Run ───────────────────────────────────────── */}
      <div style={{
        marginTop: 36,
        borderTop: "1px solid var(--line)",
        paddingTop: 28,
      }}>
        <StepLabel>Step 2 — Run Reconciliation</StepLabel>

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
          {stage === "uploading" ? "Uploading…" :
           stage === "submitting" ? "Starting…" :
           "▶  RECONCILE NOW"}
        </button>

        {!ready && !busy && !error && (
          <div style={{
            marginTop: 14,
            padding: "12px 16px",
            background: "var(--accent-bg-soft)",
            border: "1px solid var(--accent-border-soft)",
            borderRadius: 10,
            color: "var(--ink-200)",
            fontSize: 13,
          }}>
            ↑ Please upload both ledger files above, then click Reconcile.
          </div>
        )}

        {busy && (
          <div style={{
            marginTop: 14, color: "var(--ink-200)", fontSize: 13,
            fontFamily: "var(--font-mono)",
          }}>
            {progress}
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 14,
            color: "var(--error-fg)",
            padding: "12px 16px",
            border: "1px solid var(--error-border)",
            background: "var(--error-bg)",
            borderRadius: 10,
            fontSize: 13,
          }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Footer hint ────────────────────────────────────────── */}
      <div style={{
        marginTop: 28,
        textAlign: "center",
        fontSize: 11.5,
        color: "var(--ink-400)",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.03em",
      }}>
        Org Ledger Reconciliation · Supports Excel &amp; CSV ledger files from Business Central, Tally, SAP and more
      </div>
    </form>
  );
}

// ── Primitives ──────────────────────────────────────────────────────────

const gridTwo: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 16,
};

function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: "-0.015em",
      margin: "0 0 16px",
      color: "var(--ink-100)",
    }}>{children}</h2>
  );
}

function DescCard({ icon, title, accent, body }: {
  icon: string; title: string; accent: string; body: string;
}) {
  return (
    <div style={{
      background: "var(--bg-card)",
      border: "1px solid var(--line)",
      borderRadius: "var(--radius-lg)",
      padding: "22px 22px 20px",
      boxShadow: "var(--shadow-card)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        fontSize: 18, fontWeight: 600, color: accent, marginBottom: 10,
      }}>
        <span style={{ fontSize: 22 }}>{icon}</span> {title}
      </div>
      <div style={{
        fontSize: 13.5, color: "var(--ink-300)",
        lineHeight: 1.55,
      }}>{body}</div>
    </div>
  );
}

function Dropzone({ label, file, onFile, disabled }: {
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  function pick(f: File | null | undefined) {
    if (!f) return;
    onFile(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setHover(false);
    if (disabled) return;
    pick(e.dataTransfer.files?.[0]);
  }

  return (
    <div>
      <div style={{
        fontSize: 12, color: "var(--ink-400)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
        textTransform: "uppercase", marginBottom: 8,
      }}>{label}</div>

      <div
        onDragEnter={() => !disabled && setHover(true)}
        onDragLeave={() => setHover(false)}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setHover(true); }}
        onDrop={onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "18px 18px",
          background: hover ? "var(--accent-bg-soft)" : "var(--bg-elev)",
          border: `1px dashed ${hover ? "var(--accent)" : "var(--line-strong)"}`,
          borderRadius: "var(--radius-md)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.65 : 1,
          transition: "background .15s var(--ease), border-color .15s var(--ease)",
        }}
      >
        <div style={{ fontSize: 26, color: "var(--accent)" }}>⬆</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {file ? (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-100)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ✓ {file.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>
                {(file.size / 1024 / 1024).toFixed(2)} MB · click to replace
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-100)" }}>
                Drag and drop file here
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>
                Limit 50 MB · XLSX, CSV  <span style={{ opacity: 0.7 }}>· PDF / DOCX coming soon</span>
              </div>
            </>
          )}
        </div>
        <Button size="sm" type="button" variant="ghost"
          onClick={(e) => { e.stopPropagation(); if (!disabled) inputRef.current?.click(); }}>
          Browse files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          disabled={disabled}
          onChange={(e) => pick(e.target.files?.[0])}
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}
