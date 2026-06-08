"use client";

/* Feedback form. Kind switches the visible fields: review → star rating; bug /
   request → tool dropdown. Submits via the shared submitFeedback action and
   shows inline success/error (the codebase's convention — no toast library). */

import { useState, useTransition } from "react";
import { Button } from "../../core/ui/button";
import { submitFeedback, type FeedbackKind } from "./actions";

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--ink-400)",
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  marginBottom: 6,
  display: "block",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  background: "var(--bg-elev)",
  color: "var(--ink-100)",
  border: "1px solid var(--line-strong)",
  borderRadius: 10,
  outline: "none",
  boxSizing: "border-box",
};

export function FeedbackForm({ tools }: { tools: { slug: string; name: string }[] }) {
  const [kind, setKind] = useState<FeedbackKind>("review");
  const [rating, setRating] = useState(5);
  const [toolSlug, setToolSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) {
      setError("Please write a message.");
      return;
    }
    start(async () => {
      const res = await submitFeedback({
        kind,
        body,
        subject: subject || undefined,
        rating: kind === "review" ? rating : null,
        toolSlug: kind !== "review" ? toolSlug || null : null,
      });
      if (res.ok) {
        setDone(true);
        setBody("");
        setSubject("");
      } else {
        setError(res.error);
      }
    });
  }

  if (done) {
    return (
      <div
        style={{
          padding: "16px 18px",
          borderRadius: 10,
          fontSize: 14,
          color: "var(--success-fg)",
          background: "var(--success-bg)",
          border: "1px solid var(--success-border)",
        }}
      >
        ✓ Thank you — your {kind === "tool_request" ? "request" : kind} has been sent.
        <button
          type="button"
          onClick={() => setDone(false)}
          style={{ marginLeft: 10, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
        >
          Send another
        </button>
      </div>
    );
  }

  const kinds: { value: FeedbackKind; label: string }[] = [
    { value: "review", label: "Leave a review" },
    { value: "issue", label: "Report a bug" },
    { value: "tool_request", label: "Request a tool" },
  ];

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {kinds.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 999,
              cursor: "pointer",
              border: "1px solid var(--line-strong)",
              background: kind === k.value ? "var(--accent-bg-soft)" : "var(--bg-elev)",
              color: kind === k.value ? "var(--accent)" : "var(--ink-300)",
            }}
          >
            {k.label}
          </button>
        ))}
      </div>

      {kind === "review" && (
        <div>
          <label style={labelStyle}>Rating</label>
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 26,
                  lineHeight: 1,
                  color: n <= rating ? "var(--amber-fg)" : "var(--ink-500)",
                }}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      )}

      {kind !== "review" && tools.length > 0 && (
        <div>
          <label style={labelStyle}>{kind === "issue" ? "Which tool?" : "Closest existing tool (optional)"}</label>
          <select value={toolSlug} onChange={(e) => setToolSlug(e.target.value)} style={fieldStyle}>
            <option value="">{kind === "issue" ? "Select a tool…" : "None / new idea"}</option>
            {tools.map((t) => (
              <option key={t.slug} value={t.slug}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label style={labelStyle}>Subject (optional)</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} style={fieldStyle} placeholder="Short summary" />
      </div>

      <div>
        <label style={labelStyle}>
          {kind === "review" ? "Your review" : kind === "issue" ? "What went wrong?" : "Describe the tool you need"}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          style={{ ...fieldStyle, resize: "vertical", fontFamily: "var(--font-ui)" }}
          placeholder="Tell us more…"
        />
      </div>

      {error && (
        <div
          style={{
            color: "var(--error-fg)",
            padding: "12px 16px",
            border: "1px solid var(--error-border)",
            background: "var(--error-bg)",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div>
        <Button type="submit" size="md" style={{ opacity: pending ? 0.7 : 1 }}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
