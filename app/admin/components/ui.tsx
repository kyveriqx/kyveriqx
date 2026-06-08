/* Presentational primitives for the admin panel. Server-component friendly
   (no client hooks) — matches the inline-table / Pill language used in the
   tool result views, but rendered on the default dark theme. */

import type { ReactNode } from "react";
import { Card } from "../../../core/ui/card";

export { Card };

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: PillKind;
}) {
  const accent: Record<PillKind, string> = {
    ok: "var(--success-fg)",
    warn: "var(--warn-fg)",
    amber: "var(--amber-fg)",
    neutral: "var(--ink-100)",
  };
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ fontSize: 11.5, color: "var(--ink-400)", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: accent[tone] }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12.5, color: "var(--ink-300)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--line-strong)",
                  color: "var(--ink-200)",
                  fontWeight: 700,
                  fontSize: 11.5,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--line)",
        textAlign: align,
        verticalAlign: "top",
        color: "var(--ink-100)",
      }}
    >
      {children}
    </td>
  );
}

export type PillKind = "ok" | "warn" | "amber" | "neutral";

export function Pill({ kind = "neutral", children }: { kind?: PillKind; children: ReactNode }) {
  const colors: Record<PillKind, { bg: string; color: string; border: string }> = {
    ok: { bg: "var(--success-bg)", color: "var(--success-fg)", border: "var(--success-border)" },
    warn: { bg: "var(--warn-bg)", color: "var(--warn-fg)", border: "var(--warn-border)" },
    amber: { bg: "var(--amber-bg)", color: "var(--amber-fg)", border: "var(--amber-border)" },
    neutral: { bg: "var(--neutral-bg)", color: "var(--neutral-fg)", border: "var(--neutral-border)" },
  };
  const c = colors[kind];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 9px",
        fontSize: 11.5,
        fontWeight: 600,
        borderRadius: 999,
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Map a subscription/effective status to a Pill tone. */
export function statusKind(status: string): PillKind {
  if (status === "active") return "ok";
  if (status === "trial") return "amber";
  if (status === "expired" || status === "cancelled") return "warn";
  return "neutral";
}

/** Map a job/feedback status to a Pill tone. */
export function jobStatusKind(status: string): PillKind {
  if (status === "succeeded" || status === "resolved" || status === "closed") return "ok";
  if (status === "failed") return "warn";
  if (status === "running" || status === "in_progress") return "amber";
  return "neutral";
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 12px", color: "var(--ink-100)" }}>{children}</h2>
  );
}

// ── formatting helpers ──────────────────────────────────────────────────────

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}
