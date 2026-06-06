"use client";

/* Shared, calm progress card for the reconciliation tools.

   Replaces the old bare "Queued — waiting for a worker" mono-text screen
   (which read as broken) with one professional experience reused across the
   upload step AND the run step of every tool: a short reassuring heading and
   a slim animated bar pinned along the bottom of the card. The bar advances
   smoothly through stages and the parent swaps it for the finished report on
   success — so the customer sees continuous motion, never a frozen screen. */

import { useEffect, useRef, useState } from "react";
import { Card } from "./card";

export type ProgressStage = "uploading" | "queued" | "running" | "failed" | "cancelled";

const COPY: Record<ProgressStage, { title: string; sub: string }> = {
  uploading: { title: "Uploading your files…", sub: "Securely sending your documents." },
  queued: { title: "Getting things ready…", sub: "Your reconciliation is starting up." },
  running: { title: "Reconciling your ledgers…", sub: "Parsing and matching your statements." },
  failed: { title: "We couldn’t finish this reconciliation", sub: "Please check the files and try again." },
  cancelled: { title: "Reconciliation cancelled", sub: "This run was cancelled." },
};

// Where the bar eases to for each stage. It deliberately never reaches 100%
// until the parent replaces this card with the report (running holds at ~92%).
const TARGET: Record<ProgressStage, number> = {
  uploading: 30, queued: 40, running: 92, failed: 100, cancelled: 100,
};

export function JobProgress({
  stage, detail, pct, error,
}: {
  stage: ProgressStage;
  /** Optional sub-line override (e.g. "Uploading file 1 of 2…"). */
  detail?: string;
  /** Explicit 0–100 for the upload step (real file x/y progress). */
  pct?: number;
  /** Error text for failed/cancelled — shown softly, not as a red dump. */
  error?: string | null;
}) {
  const isError = stage === "failed" || stage === "cancelled";
  const [display, setDisplay] = useState(stage === "uploading" ? Math.max(pct ?? 0, 6) : 16);

  useEffect(() => {
    if (isError) { setDisplay(100); return; }
    const id = setInterval(() => {
      setDisplay((d) => {
        const target = pct != null ? pct : TARGET[stage];
        if (Math.abs(target - d) < 0.4) return target;
        return d + (target - d) * 0.06;
      });
    }, 120);
    return () => clearInterval(id);
  }, [stage, pct, isError]);

  const copy = COPY[stage];
  const width = Math.max(0, Math.min(100, display));
  const fill = isError ? "var(--error-border)" : "linear-gradient(90deg, var(--accent-grad-start), var(--accent-grad-end))";

  return (
    <Card style={{ padding: "28px 28px 30px", minHeight: 132 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {!isError && (
          <span
            aria-hidden
            className="kx-spin"
            style={{
              width: 20, height: 20, flexShrink: 0,
              borderRadius: "50%",
              border: "2.5px solid var(--accent-border-soft)",
              borderTopColor: "var(--accent)",
            }}
          />
        )}
        <div>
          <div style={{ fontSize: 17, fontWeight: 650, color: isError ? "var(--error-fg)" : "var(--ink-100)" }}>
            {copy.title}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-300)", marginTop: 3 }}>
            {detail ?? copy.sub}
          </div>
        </div>
      </div>

      {isError && error && (
        <div
          style={{
            marginTop: 14, fontSize: 12.5, lineHeight: 1.5,
            color: "var(--ink-300)", background: "var(--bg-elev)",
            border: "1px solid var(--line)", borderRadius: "var(--radius-sm)",
            padding: "10px 12px", whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {/* progress bar pinned along the bottom edge of the card */}
      <div
        aria-hidden
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: 5,
          background: "var(--bg-elev)",
        }}
      >
        <div
          style={{
            position: "relative", height: "100%", width: `${width}%`,
            background: fill,
            borderTopRightRadius: 4, borderBottomRightRadius: 4,
            transition: "width 0.45s cubic-bezier(0.22, 0.61, 0.36, 1)",
            overflow: "hidden",
          }}
        >
          {!isError && (
            <span
              className="kx-bar-shimmer"
              style={{
                position: "absolute", top: 0, bottom: 0, width: "40%",
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
              }}
            />
          )}
        </div>
      </div>
    </Card>
  );
}
