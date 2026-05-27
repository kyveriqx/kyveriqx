"use client";

/* Upload + run UI for Bank Ledger Reconciliation.
   Uploads the bank statement + books ledger (+ optional Razorpay settlement
   report) through the generic /api/uploads route, then calls the server
   action to create the job and kick off the Trigger.dev task. Once a job id
   comes back it hands off to <Results> for live status + the report. */

import { useState } from "react";
import { Card } from "../../core/ui/card";
import { Button } from "../../core/ui/button";
import { runBankReconcileAction } from "./run-action";
import { Results } from "./results";

type FileKind = "bank" | "books" | "settlement";

async function uploadFile(file: File, kind: FileKind): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("toolSlug", "bankledgerreco");
  fd.append("kind", kind);
  const res = await fetch("/api/uploads", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `upload failed (${res.status})`);
  return data.id as string;
}

function FilePick({
  label, hint, file, onPick, accept,
}: {
  label: string; hint: string; file: File | null;
  onPick: (f: File | null) => void; accept: string;
}) {
  return (
    <label style={{ display: "block", cursor: "pointer" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-100)", marginBottom: 6 }}>{label}</div>
      <div
        style={{
          border: "1px dashed var(--line-strong)",
          borderRadius: 12,
          padding: "14px 16px",
          background: "var(--bg-elev)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 14, color: file ? "var(--ink-100)" : "var(--ink-400)" }}>
          {file ? file.name : hint}
        </span>
        <span style={{ fontSize: 12, color: "var(--blue-400)", fontWeight: 600 }}>
          {file ? "Change" : "Choose file"}
        </span>
      </div>
      <input
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export function UploadRun({ initialJobId }: { initialJobId?: string }) {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [booksFile, setBooksFile] = useState<File | null>(null);
  const [settlementFile, setSettlementFile] = useState<File | null>(null);
  const [dateWindowDays, setDateWindowDays] = useState(3);
  const [feeCeilingPct, setFeeCeilingPct] = useState(3);
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(initialJobId ?? null);

  if (jobId) {
    return (
      <div style={{ maxWidth: 1100, display: "grid", gap: 16 }}>
        <Results jobId={jobId} />
        <button
          onClick={() => { setJobId(null); setBankFile(null); setBooksFile(null); setSettlementFile(null); setError(null); }}
          style={{ justifySelf: "start", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 14, color: "var(--blue-400)" }}
        >
          ← Run another
        </button>
      </div>
    );
  }

  async function run() {
    setError(null);
    if (!bankFile || !booksFile) {
      setError("Please choose both a bank statement and a books ledger.");
      return;
    }
    setPhase("working");
    try {
      const [bankUploadId, booksUploadId, settlementUploadId] = await Promise.all([
        uploadFile(bankFile, "bank"),
        uploadFile(booksFile, "books"),
        settlementFile ? uploadFile(settlementFile, "settlement") : Promise.resolve(undefined),
      ]);
      const { jobId: id } = await runBankReconcileAction({
        bankUploadId,
        booksUploadId,
        settlementUploadId: settlementUploadId as string | undefined,
        options: { dateWindowDays, feeCeilingPct },
      });
      // keep the job id in the URL so a refresh resumes the same run
      window.history.replaceState(null, "", `?jobId=${id}`);
      setJobId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }

  return (
    <Card style={{ padding: 24, maxWidth: 720 }}>
      <div style={{ display: "grid", gap: 18 }}>
        <FilePick
          label="Bank statement"
          hint="CSV or XLSX exported from your bank"
          accept=".csv,.xlsx,.xls"
          file={bankFile}
          onPick={setBankFile}
        />
        <FilePick
          label="Books ledger"
          hint="Your bank-account ledger from Tally / Zoho / BC"
          accept=".csv,.xlsx,.xls"
          file={booksFile}
          onPick={setBooksFile}
        />
        <FilePick
          label="Razorpay settlement report (optional)"
          hint="For exact gateway fee + GST reconciliation"
          accept=".csv,.xlsx,.xls"
          file={settlementFile}
          onPick={setSettlementFile}
        />

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: "var(--ink-300)" }}>
            Date tolerance (days)
            <input
              type="number" min={0} max={15} value={dateWindowDays}
              onChange={(e) => setDateWindowDays(Math.max(0, Number(e.target.value) || 0))}
              style={{ marginLeft: 8, width: 60, padding: "4px 8px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--bg-elev)", color: "var(--ink-100)" }}
            />
          </label>
          <label style={{ fontSize: 13, color: "var(--ink-300)" }}>
            Max gateway fee (%)
            <input
              type="number" min={0} max={10} step={0.5} value={feeCeilingPct}
              onChange={(e) => setFeeCeilingPct(Math.max(0, Number(e.target.value) || 0))}
              style={{ marginLeft: 8, width: 60, padding: "4px 8px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--bg-elev)", color: "var(--ink-100)" }}
            />
          </label>
        </div>

        {error && (
          <div style={{ color: "var(--error-fg)", fontSize: 13, background: "var(--error-bg)", border: "1px solid var(--error-border)", padding: 10, borderRadius: 8 }}>
            {error}
          </div>
        )}

        <div>
          <Button onClick={run} disabled={phase === "working"}>
            {phase === "working" ? "Starting…" : "Run reconciliation"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
