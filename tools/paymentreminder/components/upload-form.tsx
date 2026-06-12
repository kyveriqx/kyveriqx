"use client";

/* Upload form for the Customer Payment Reminder tool.

   Three-part flow:
     1. Drop a CSV/Excel of customers (must contain at least Email; name,
        amount, balance, invoice number/details and due date are optional)
     2. Type a subject and HTML body — both support the merge fields
        {{name}} {{amount}} {{balance}} {{invoice_number}}
        {{invoice_details}} {{due_date}}
     3. Click Send Reminders

   The dropzone primitive is copied from the ledgerreco tools. The customer
   file uploads first via /api/uploads, then the resulting upload ID is
   submitted to the server action which triggers the Trigger.dev task. */

import { useState, useRef, useTransition, type DragEvent } from "react";
import { Button } from "../../../core/ui/button";
import { runPaymentReminderAction } from "../run-action";
import { applyMerge } from "../lib/merge";
import type { Recipient } from "../lib/types";

type Stage = "idle" | "uploading" | "submitting";

const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";
const MAX_BYTES = 50 * 1024 * 1024;

const DEFAULT_SUBJECT = "Payment reminder - invoice {{invoice_number}} ({{currency}} {{amount}} due)";
const DEFAULT_BODY =
  "<p>Dear {{name}},</p>\n\n" +
  "<p>This is a gentle reminder that invoice <b>{{invoice_number}}</b> " +
  "({{invoice_details}}) for <b>{{currency}} {{amount}}</b> is currently pending.</p>\n\n" +
  "<p>As on date, your total outstanding balance with us is <b>{{currency}} {{balance}}</b>. " +
  "We request you to kindly clear the dues by <b>{{due_date}}</b>.</p>\n\n" +
  "<p>If you have already made the payment, please ignore this message.</p>\n\n" +
  "<p>Thanks,<br/>Your team</p>";

// Fixed sample values for the live preview — name follows the "Preview as"
// box, the rest stay constant so the user can see every merge field fill in.
// Currency is a code (INR/USD), not a symbol, so it survives CSV/Excel cleanly.
const SAMPLE_PREVIEW: Omit<Recipient, "name" | "email"> = {
  currency: "INR",
  amount: "12,000",
  balance: "45,000",
  invoiceNumber: "INV-2026-118",
  invoiceDetails: "Consulting - March 2026",
  dueDate: "20-06-2026",
};

export function UploadForm({ defaultPreviewName }: { defaultPreviewName?: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [previewName, setPreviewName] = useState(defaultPreviewName?.trim() || "Asha");
  const [, startTransition] = useTransition();

  async function uploadFile(file: File): Promise<string> {
    if (file.size > MAX_BYTES) {
      throw new Error(`${file.name} is larger than 50 MB.`);
    }
    setProgress(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("toolSlug", "paymentreminder");
    fd.set("kind", "recipients");
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!res.ok) {
      let msg = `Upload failed (HTTP ${res.status})`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    const j = (await res.json()) as { id: string };
    return j.id;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (files.length !== 1) {
      setError("Please attach exactly one customer file.");
      return;
    }
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (!body.trim()) {
      setError("Reminder body is required.");
      return;
    }
    try {
      setStage("uploading");
      const uploadId = await uploadFile(files[0]);
      setStage("submitting");
      setProgress("Starting reminders…");
      const fd = new FormData();
      fd.set("recipientsUploadId", uploadId);
      fd.set("subject", subject);
      fd.set("body", body);
      startTransition(async () => {
        try {
          await runPaymentReminderAction(fd);
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

  // Build a tiny sample CSV on the fly and download it — shows the exact shape
  // we expect (Email is required; the rest power the merge fields) so the user
  // doesn't have to guess the format.
  function downloadSample() {
    // Currency is a code column (INR/USD), and amounts are plain numbers with
    // no symbol — a "₹" stored in a CSV gets garbled when Excel opens it as
    // ANSI. A leading BOM (﻿) tells Excel the file is UTF-8 so any other
    // non-ASCII (names, particulars) also renders correctly.
    const csv =
      "﻿" +
      "Name,Email,Invoice Number,Currency,Amount,Balance,Due Date,Invoice Details\r\n" +
      "Asha Mehta,asha@example.com,INV-2026-118,INR,\"12,000\",\"45,000\",20-06-2026,Consulting - March 2026\r\n" +
      "Ravi Kumar,ravi@example.com,INV-2026-121,INR,\"8,500\",\"8,500\",22-06-2026,Annual maintenance\r\n" +
      "Priya Nair,priya@example.com,INV-2026-126,USD,\"1,200\",\"2,400\",25-06-2026,Project milestone 2\r\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-customers.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const busy = stage !== "idle";
  const ready = files.length === 1 && subject.trim() && body.trim() && !busy;

  return (
    <form onSubmit={onSubmit}>
      {/* Banner */}
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
          <span style={{ fontSize: 22 }}>💳</span> Customer Payment Reminder
        </div>
        <div style={{
          fontSize: 13,
          color: "var(--text-on-banner-muted)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.01em",
        }}>
          Upload list → Write reminder → Click Send
        </div>
      </div>

      <HowItWorks />

      {/* Two columns: editor on the left, live preview on the right. Collapses
          to a single column on narrow screens via auto-fit. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        gap: 28,
        alignItems: "start",
      }}>
        <div>
      {/* Step 1 — Customers */}
      <StepLabel>Step 1 — Customer list</StepLabel>
      <DescCard
        icon="📋"
        title="CSV or Excel with one row per customer"
        body="Your file needs at least an Email column. Optional columns — Name, Invoice Number, Currency (e.g. INR/USD), Amount, Balance, Due Date and Invoice Details — power the merge fields in your reminder. Use a currency code, not a ₹/$ symbol, so amounts stay clean in Excel. Blank rows and invalid email addresses are skipped automatically."
      />
      <div style={{
        marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        fontSize: 13, color: "var(--ink-300)",
      }}>
        <span>New here? Download a sample to see the exact format:</span>
        <button
          type="button"
          onClick={downloadSample}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", fontSize: 12.5, fontWeight: 600,
            color: "var(--accent)", background: "var(--accent-bg-soft)",
            border: "1px solid var(--accent-border-soft)", borderRadius: 8,
            cursor: "pointer",
          }}
        >
          ⬇ Download sample CSV
        </button>
      </div>
      <div style={{ marginTop: 14 }}>
        <Dropzone
          label="Upload customer list"
          hint="One file · 50 MB max · XLSX or CSV"
          accept={ACCEPT}
          files={files}
          onFiles={setFiles}
          disabled={busy}
        />
      </div>

      {/* Step 2 — Message */}
      <div style={{ marginTop: 36, borderTop: "1px solid var(--line)", paddingTop: 28 }}>
        <StepLabel>Step 2 — Write your reminder</StepLabel>
        <DescCard
          icon="✍️"
          title="Merge fields personalise every reminder"
          body="Use {{name}}, {{invoice_number}}, {{currency}}, {{amount}}, {{balance}}, {{due_date}} and {{invoice_details}} anywhere in the subject or body — each one is replaced per customer from your file. Pair {{currency}} {{amount}} to show e.g. INR 12,000. Body is HTML — use simple tags (<p>, <br/>, <b>, <a href>) or paste a designed template."
        />
        <MergeChips />
        <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
          <Field label="Subject">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={busy}
              placeholder="Payment reminder — invoice {{invoice_number}}"
              style={inputStyle}
            />
          </Field>
          <Field label="Body (HTML)">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={busy}
              rows={14}
              style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 13, resize: "vertical" }}
            />
          </Field>
        </div>
      </div>

      {/* Step 3 — Send */}
      <div style={{ marginTop: 36, borderTop: "1px solid var(--line)", paddingTop: 28 }}>
        <StepLabel>Step 3 — Send</StepLabel>
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
           "▶  SEND REMINDERS"}
        </button>

        {!ready && !busy && !error && (
          <div style={{
            marginTop: 14, padding: "12px 16px",
            background: "var(--accent-bg-soft)", border: "1px solid var(--accent-border-soft)",
            borderRadius: 10, color: "var(--ink-200)", fontSize: 13,
          }}>
            ↑ Attach a list, write a subject + body, then click Send.
          </div>
        )}

        {busy && (
          <div style={{ marginTop: 14, color: "var(--ink-200)", fontSize: 13, fontFamily: "var(--font-mono)" }}>
            {progress}
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
        Customer Payment Reminder · Sent from your connected mailbox · merge fields supported
      </div>
        </div>{/* end left column */}

        <EmailPreview
          subject={subject}
          body={body}
          previewName={previewName}
          onPreviewName={setPreviewName}
        />
      </div>{/* end two-column grid */}
    </form>
  );
}

/** The merge fields available, shown as copyable-looking chips so a customer
 *  knows exactly what they can drop into the subject and body. */
function MergeChips() {
  const fields = [
    "{{name}}", "{{invoice_number}}", "{{currency}}", "{{amount}}",
    "{{balance}}", "{{due_date}}", "{{invoice_details}}",
  ];
  return (
    <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
      {fields.map((f) => (
        <span key={f} style={{
          fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)",
          background: "var(--accent-bg-soft)", border: "1px solid var(--accent-border-soft)",
          borderRadius: 7, padding: "3px 9px",
        }}>
          {f}
        </span>
      ))}
    </div>
  );
}

/** Live preview of the reminder exactly as a customer will see it: subject and
 *  HTML body rendered with the merge fields filled for a sample customer.
 *  Sticky so it stays in view while the editor on the left scrolls. */
function EmailPreview({
  subject,
  body,
  previewName,
  onPreviewName,
}: {
  subject: string;
  body: string;
  previewName: string;
  onPreviewName: (v: string) => void;
}) {
  const sampleRow: Partial<Recipient> = { name: previewName, ...SAMPLE_PREVIEW };
  const mergedSubject = applyMerge(subject, sampleRow);
  const mergedBody = applyMerge(body, sampleRow);
  const sampleEmail = `${(previewName || "asha").toLowerCase().split(" ")[0]}@example.com`;

  return (
    <div style={{ position: "sticky", top: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{
          fontSize: 12, color: "var(--ink-400)", fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em", textTransform: "uppercase",
        }}>
          Live preview
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-400)" }}>
          Preview as
          <input
            type="text"
            value={previewName}
            onChange={(e) => onPreviewName(e.target.value)}
            placeholder="Asha"
            style={{
              width: 120, padding: "5px 8px", fontSize: 12.5,
              background: "var(--bg-card)", color: "var(--ink-100)",
              border: "1px solid var(--line-strong)", borderRadius: 8, outline: "none",
            }}
          />
        </label>
      </div>

      {/* The email itself — rendered on white so it looks like a real inbox
          message regardless of the app's dark theme. */}
      <div style={{
        border: "1px solid var(--line-strong)", borderRadius: "var(--radius-md)",
        overflow: "hidden", boxShadow: "var(--shadow-card)", background: "#ffffff",
      }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
          <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            To
          </div>
          <div style={{ fontSize: 13, color: "#374151" }}>
            {previewName || "Asha"} &lt;{sampleEmail}&gt;
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 10 }}>
            Subject
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", wordBreak: "break-word" }}>
            {mergedSubject || <span style={{ color: "#9ca3af", fontWeight: 400 }}>(your subject appears here)</span>}
          </div>
        </div>
        <div style={{ padding: "18px", minHeight: 160, color: "#1f2937", fontSize: 14, lineHeight: 1.6 }}>
          {body.trim() ? (
            <div
              style={{ wordBreak: "break-word" }}
              dangerouslySetInnerHTML={{ __html: mergedBody }}
            />
          ) : (
            <div style={{ color: "#9ca3af" }}>Your reminder appears here as you type — exactly as the customer will see it.</div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--ink-400)" }}>
        Merge fields are replaced per customer. This preview uses the name above and sample invoice values.
      </div>
    </div>
  );
}

// ── In-app user guide ───────────────────────────────────────────────────────

/** Plain-language, collapsible "how to send reminders" guide for non-technical
 *  customers. Sits at the top of the compose screen; collapsed by default so it
 *  doesn't crowd repeat users. */
function HowItWorks() {
  const [open, setOpen] = useState(false);
  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: "Connect your mailbox (once)",
      body: <>Click <b>Connect Microsoft</b> and sign in on Microsoft’s own page. Reminders are sent <i>from your own mailbox</i> — we never see or store your password. If you already connected it for Email Campaigns, it’s ready here too.</>,
    },
    {
      title: "Upload your customer list",
      body: <>Drop a CSV or Excel file with an <b>Email</b> column. Add <b>Name</b>, <b>Invoice Number</b>, <b>Currency</b> (INR/USD), <b>Amount</b>, <b>Balance</b>, <b>Due Date</b> and <b>Invoice Details</b> columns to personalise each reminder. Not sure of the format? Click <b>Download sample CSV</b>.</>,
    },
    {
      title: "Write your reminder",
      body: <>Type a subject and body, dropping in merge fields like <b>{`{{name}}`}</b>, <b>{`{{amount}}`}</b>, <b>{`{{invoice_number}}`}</b> and <b>{`{{due_date}}`}</b>. The <b>live preview</b> on the right shows exactly what a customer will receive.</>,
    },
    {
      title: "Send & track",
      body: <>Click <b>Send reminders</b>. You’ll see live progress, then a summary of how many were delivered and any that failed — with the reason for each.</>,
    },
  ];

  return (
    <div style={{
      border: "1px solid var(--line)", borderRadius: "var(--radius-md)",
      background: "var(--bg-card)", marginBottom: 24, overflow: "hidden",
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "14px 18px", background: "transparent", border: "none",
          cursor: "pointer", textAlign: "left", color: "var(--ink-100)", fontSize: 14.5, fontWeight: 600,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>📖</span> How payment reminders work — a quick guide
        </span>
        <span style={{ fontSize: 12, color: "var(--ink-400)", fontFamily: "var(--font-mono)" }}>
          {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div style={{ padding: "4px 20px 20px", borderTop: "1px solid var(--line)" }}>
          <ol style={{ margin: "16px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 14 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 12, alignItems: "start" }}>
                <span style={{
                  width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: "var(--accent-bg-soft)", color: "var(--accent)",
                  fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono)",
                }}>
                  {i + 1}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-100)" }}>{s.title}</div>
                  <div style={{ fontSize: 13.5, color: "var(--ink-300)", lineHeight: 1.55, marginTop: 3 }}>{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
          <div style={{
            marginTop: 16, padding: "10px 14px", fontSize: 13, lineHeight: 1.55,
            background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink-300)",
          }}>
            <b style={{ color: "var(--ink-200)" }}>If something goes wrong:</b> we’ll explain it in plain language and show you exactly how to fix it — most often it’s just reconnecting your mailbox.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Primitives (same visual language as the ledgerreco tools) ───────────────

function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", margin: "0 0 16px", color: "var(--ink-100)" }}>
      {children}
    </h2>
  );
}

function DescCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--line)",
      borderRadius: "var(--radius-lg)", padding: "22px 22px 20px", boxShadow: "var(--shadow-card)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 18, fontWeight: 600, color: "var(--bg-banner-start)", marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>{icon}</span> {title}
      </div>
      <div style={{ fontSize: 13.5, color: "var(--ink-300)", lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{
        fontSize: 12, color: "var(--ink-400)", fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  background: "var(--bg-card)",
  color: "var(--ink-100)",
  border: "1px solid var(--line-strong)",
  borderRadius: 10,
  outline: "none",
};

function Dropzone({ label, hint, accept, files, onFiles, disabled }: {
  label: string; hint: string; accept: string; files: File[]; onFiles: (f: File[]) => void; disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  function setOne(list: FileList | null | undefined) {
    if (!list || !list.length) return;
    onFiles([list[0]]);
  }
  function removeAt(idx: number) { onFiles(files.filter((_, i) => i !== idx)); }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setHover(false); if (disabled) return; setOne(e.dataTransfer.files);
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
              ✓ {files[0].name}
              <span style={{ fontWeight: 400, color: "var(--ink-400)" }}> · click to replace</span>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-100)" }}>Drag and drop file here</div>
              <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>{hint}</div>
            </>
          )}
        </div>
        <Button size="sm" type="button" variant="ghost"
          onClick={(e) => { e.stopPropagation(); if (!disabled) inputRef.current?.click(); }}>
          Browse file
        </Button>
        <input
          ref={inputRef} type="file" accept={accept} disabled={disabled}
          onChange={(e) => { setOne(e.target.files); e.currentTarget.value = ""; }} style={{ display: "none" }}
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
