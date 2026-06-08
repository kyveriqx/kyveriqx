/* Floating "Report an issue" widget shown on every tool page (mounted from
   app/tools/layout.tsx). Opens a small modal pre-tagged to the current tool so
   the issue lands in the admin inbox already linked to that tool. Reuses the
   shared submitFeedback server action with kind='issue'. */

"use client";

import { useState, useTransition } from "react";
import { submitFeedback } from "../../app/feedback/actions";

export function ReportIssueButton({
  toolSlug,
  toolName,
}: {
  toolSlug: string;
  toolName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setBody("");
    setDone(false);
    setError(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) {
      setError("Please describe the issue.");
      return;
    }
    startTransition(async () => {
      const res = await submitFeedback({ kind: "issue", toolSlug, body });
      if (res.ok) setDone(true);
      else setError(res.error);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { reset(); setOpen(true); }}
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 60,
          padding: "10px 16px",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ink-100)",
          background: "var(--navy-700, #1B263B)",
          border: "1px solid var(--line-strong)",
          borderRadius: 999,
          boxShadow: "0 8px 24px -8px rgba(0,0,0,0.4)",
          cursor: "pointer",
        }}
      >
        Report an issue
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 460,
              background: "var(--bg-base, #fff)",
              color: "var(--text-primary, #111)",
              border: "1px solid var(--line-strong)",
              borderRadius: 14,
              padding: 22,
              boxShadow: "0 30px 60px -20px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Report an issue</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-secondary, #666)", lineHeight: 1 }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-secondary, #666)" }}>
              {toolName ? `${toolName} — ` : ""}tell us what went wrong (wrong result, error, missing download…).
            </p>

            {done ? (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  fontSize: 13,
                  color: "var(--success-fg)",
                  background: "var(--success-bg)",
                  border: "1px solid var(--success-border)",
                }}
              >
                ✓ Thanks — we&apos;ve logged this and will look into it.
              </div>
            ) : (
              <form onSubmit={onSubmit}>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  placeholder="Describe the issue…"
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: 14,
                    borderRadius: 10,
                    border: "1px solid var(--line-strong)",
                    background: "var(--bg-elev, #fff)",
                    color: "inherit",
                    resize: "vertical",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />
                {error && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "10px 14px",
                      borderRadius: 10,
                      fontSize: 13,
                      color: "var(--error-fg)",
                      background: "var(--error-bg)",
                      border: "1px solid var(--error-border)",
                    }}
                  >
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={pending}
                  style={{
                    marginTop: 14,
                    width: "100%",
                    padding: "12px 18px",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--accent-fg)",
                    background: "linear-gradient(180deg, var(--accent-grad-start) 0%, var(--accent-grad-end) 100%)",
                    border: "none",
                    borderRadius: 999,
                    cursor: pending ? "default" : "pointer",
                    opacity: pending ? 0.7 : 1,
                  }}
                >
                  {pending ? "Sending…" : "Send report"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
