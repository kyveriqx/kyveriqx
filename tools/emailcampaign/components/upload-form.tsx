"use client";

/* Upload form for the email campaign tool.

   Three-part flow:
     1. Drop a CSV/Excel of recipients (must contain at least Email; Name optional)
     2. Type a subject and HTML body — both support {{name}} merge
     3. Click Send Campaign

   The dropzone primitive is copied from the ledgerreco tools (it isn't
   exported from core/ui yet). The recipient file uploads first via
   /api/uploads, then the resulting upload ID is submitted to the
   server action which triggers the Trigger.dev task. */

import { useState, useRef, useTransition, type DragEvent } from "react";
import { Button } from "../../../core/ui/button";
import { runEmailCampaignAction } from "../run-action";

type Stage = "idle" | "uploading" | "submitting";

const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";
const MAX_BYTES = 50 * 1024 * 1024;

export function UploadForm() {
  const [files, setFiles] = useState<File[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(
    "<p>Hi {{name}},</p>\n\n<p>Write your message here.</p>\n\n<p>Thanks,<br/>Your team</p>",
  );
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [, startTransition] = useTransition();

  async function uploadFile(file: File): Promise<string> {
    if (file.size > MAX_BYTES) {
      throw new Error(`${file.name} is larger than 50 MB.`);
    }
    setProgress(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("toolSlug", "emailcampaign");
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
      setError("Please attach exactly one recipient file.");
      return;
    }
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (!body.trim()) {
      setError("Email body is required.");
      return;
    }
    try {
      setStage("uploading");
      const uploadId = await uploadFile(files[0]);
      setStage("submitting");
      setProgress("Starting campaign…");
      const fd = new FormData();
      fd.set("recipientsUploadId", uploadId);
      fd.set("subject", subject);
      fd.set("body", body);
      startTransition(async () => {
        try {
          await runEmailCampaignAction(fd);
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
          <span style={{ fontSize: 22 }}>✉️</span> Email Campaigns
        </div>
        <div style={{
          fontSize: 13,
          color: "var(--text-on-banner-muted)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.01em",
        }}>
          Upload list → Write message → Click Send
        </div>
      </div>

      {/* Step 1 — Recipients */}
      <StepLabel>Step 1 — Recipient list</StepLabel>
      <DescCard
        icon="📋"
        title="CSV or Excel with one row per recipient"
        body="Your file needs at least an Email column. A Name column is optional — when present, it powers the {{name}} merge field in your subject and body. Blank rows and invalid email addresses are skipped automatically."
      />
      <div style={{ marginTop: 14 }}>
        <Dropzone
          label="Upload recipient list"
          hint="One file · 50 MB max · XLSX or CSV"
          accept={ACCEPT}
          files={files}
          onFiles={setFiles}
          disabled={busy}
        />
      </div>

      {/* Step 2 — Message */}
      <div style={{ marginTop: 36, borderTop: "1px solid var(--line)", paddingTop: 28 }}>
        <StepLabel>Step 2 — Write your message</StepLabel>
        <DescCard
          icon="✍️"
          title="Use {{name}} anywhere to merge the recipient's name"
          body="Both subject and body support {{name}}. Body is HTML — use simple tags (<p>, <br/>, <a href>) or paste a designed template from your existing tool."
        />
        <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
          <Field label="Subject">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={busy}
              placeholder="Hi {{name}}, a quick update from us"
              style={inputStyle}
            />
          </Field>
          <Field label="Body (HTML)">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={busy}
              rows={12}
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
           "▶  SEND CAMPAIGN"}
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
        Email Campaigns · Sent via your own SMTP relay · {`{{name}}`} merge supported
      </div>
    </form>
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
