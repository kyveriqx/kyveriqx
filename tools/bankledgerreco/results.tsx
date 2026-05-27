"use client";

/* Live bank-reconciliation results — polls /api/jobs/[id] (the browser
   never talks to Trigger.dev directly) and, on success, renders the
   BankReconcileResult: summary cards, tabbed match/exception tables, and a
   CSV export of the exceptions. */

import { useEffect, useRef, useState } from "react";
import { Card } from "../../core/ui/card";
import { Button } from "../../core/ui/button";
import type { BankReconcileResult, MatchGroup, MatchMethod, UnmatchedSide } from "./lib/types";

type JobStatusValue = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type Job = { id: string; status: JobStatusValue; result: unknown; error: string | null; updated_at: string; job_key: string };
const TERMINAL: JobStatusValue[] = ["succeeded", "failed", "cancelled"];
const MAX_ROWS = 250;

const inr = (n: number) =>
  n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

const METHOD_LABEL: Record<MatchMethod, string> = {
  exact: "Exact",
  "date-tolerant": "Date ±",
  "group-exact": "Grouped",
  "group-fee": "Gateway fee",
  settlement: "Settlement",
  reversal: "Reversal",
};

const HINT_LABEL: Record<string, string> = {
  "bank-charge": "Bank charge",
  interest: "Interest",
  tds: "TDS",
  "possible-reversal": "Possible reversal",
};

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportExceptions(r: BankReconcileResult) {
  const header = ["Side", "Row", "Date", "Description", "Debit", "Credit", "Flag"];
  const rows: (string | number)[][] = [header];
  const push = (side: string, u: UnmatchedSide) =>
    rows.push([side, u.row, u.date ?? "", u.description, u.debit, u.credit, u.hint ? HINT_LABEL[u.hint] : ""]);
  r.unmatchedBank.forEach((u) => push("Bank", u));
  r.unmatchedBooks.forEach((u) => push("Books", u));
  downloadCsv("bank-reconciliation-exceptions.csv", rows);
}

// ── small presentational bits ────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "var(--error-fg)" : tone === "ok" ? "var(--blue-400)" : "var(--ink-100)";
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
    </Card>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "exact" | "group" | "fee" | "warn" }) {
  const bg =
    tone === "exact" ? "rgba(0,194,255,0.14)" :
    tone === "fee" ? "rgba(255,176,32,0.16)" :
    tone === "warn" ? "var(--error-bg)" : "rgba(255,255,255,0.06)";
  const fg =
    tone === "exact" ? "var(--blue-400)" :
    tone === "fee" ? "#FFB020" :
    tone === "warn" ? "var(--error-fg)" : "var(--ink-200)";
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: bg, color: fg, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: "var(--ink-400)", fontWeight: 600, padding: "8px 10px", borderBottom: "1px solid var(--line)", textTransform: "uppercase", letterSpacing: "0.04em" };
const td: React.CSSProperties = { fontSize: 13, color: "var(--ink-200)", padding: "8px 10px", borderBottom: "1px solid var(--line)", verticalAlign: "top" };

function Table({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table></div>;
}

function methodTone(m: MatchMethod): "exact" | "group" | "fee" | "warn" {
  if (m === "exact" || m === "date-tolerant") return "exact";
  if (m === "group-fee" || m === "settlement") return "fee";
  if (m === "reversal") return "warn";
  return "group";
}

function MatchedTable({ groups }: { groups: MatchGroup[] }) {
  if (!groups.length) return <Empty>No matches.</Empty>;
  return (
    <Table>
      <thead><tr>
        <th style={th}>Method</th><th style={th}>Bank rows</th><th style={th}>Books rows</th>
        <th style={th}>Bank amt</th><th style={th}>Books amt</th><th style={th}>Fee</th>
        <th style={th}>Date gap</th><th style={th}>Note</th>
      </tr></thead>
      <tbody>
        {groups.slice(0, MAX_ROWS).map((g) => (
          <tr key={g.id}>
            <td style={td}><Badge tone={methodTone(g.method)}>{METHOD_LABEL[g.method]}</Badge> <span style={{ color: "var(--ink-500)", fontSize: 11 }}>{g.confidence}</span></td>
            <td style={td}>{g.bankRows.join(", ") || "—"}</td>
            <td style={td}>{g.booksRows.join(", ") || "—"}</td>
            <td style={td}>{inr(g.bankAmount)}</td>
            <td style={td}>{inr(g.booksAmount)}</td>
            <td style={td}>{g.fee ? `${inr(g.fee)}${g.feeRatePct != null ? ` (${g.feeRatePct}%)` : ""}` : "—"}</td>
            <td style={td}>{g.dateGapDays ? `${g.dateGapDays}d` : "0"}</td>
            <td style={td}>{g.note ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function UnmatchedTable({ rows }: { rows: UnmatchedSide[] }) {
  if (!rows.length) return <Empty>Nothing unmatched — fully reconciled. ✓</Empty>;
  return (
    <Table>
      <thead><tr>
        <th style={th}>Row</th><th style={th}>Date</th><th style={th}>Description</th>
        <th style={th}>Debit</th><th style={th}>Credit</th><th style={th}>Flag</th>
      </tr></thead>
      <tbody>
        {rows.slice(0, MAX_ROWS).map((u) => (
          <tr key={u.row}>
            <td style={td}>{u.row}</td>
            <td style={td}>{u.date ?? "—"}</td>
            <td style={td}>{u.description || "—"}</td>
            <td style={td}>{u.debit ? inr(u.debit) : "—"}</td>
            <td style={td}>{u.credit ? inr(u.credit) : "—"}</td>
            <td style={td}>{u.hint ? <Badge tone="warn">{HINT_LABEL[u.hint]}</Badge> : ""}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 24, textAlign: "center", color: "var(--ink-400)", fontSize: 14 }}>{children}</div>;
}

function Report({ r }: { r: BankReconcileResult }) {
  const tabs = [
    { key: "matched", label: `Matched (${r.groups.length})` },
    { key: "ubank", label: `Unmatched bank (${r.unmatchedBank.length})` },
    { key: "ubooks", label: `Unmatched books (${r.unmatchedBooks.length})` },
  ] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]["key"]>("matched");
  const s = r.summary;
  const reconciled = Math.abs(s.netGap) < 0.01;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <Stat label="Matched groups" value={String(s.matchedGroups)} tone="ok" />
        <Stat label="Unmatched bank" value={String(s.unmatchedBankCount)} tone={s.unmatchedBankCount ? "warn" : undefined} />
        <Stat label="Unmatched books" value={String(s.unmatchedBooksCount)} tone={s.unmatchedBooksCount ? "warn" : undefined} />
        <Stat label="Net gap" value={inr(s.netGap)} tone={reconciled ? "ok" : "warn"} />
        <Stat label="Gateway fees" value={inr(s.feesIdentified)} />
        <Stat label="Bank charges" value={inr(s.bankChargesTotal)} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 14px", borderRadius: "var(--radius-pill)", cursor: "pointer",
              fontSize: 13, fontWeight: 600,
              border: "1px solid " + (tab === t.key ? "transparent" : "var(--line-strong)"),
              background: tab === t.key ? "var(--blue-400)" : "var(--bg-elev)",
              color: tab === t.key ? "var(--accent-fg)" : "var(--ink-200)",
            }}
          >
            {t.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <Button size="sm" variant="ghost" onClick={() => exportExceptions(r)}>Download exceptions (CSV)</Button>
        </div>
      </div>

      <Card style={{ padding: 8 }}>
        {tab === "matched" && <MatchedTable groups={r.groups} />}
        {tab === "ubank" && <UnmatchedTable rows={r.unmatchedBank} />}
        {tab === "ubooks" && <UnmatchedTable rows={r.unmatchedBooks} />}
      </Card>

      {(r.groups.length > MAX_ROWS || r.unmatchedBank.length > MAX_ROWS || r.unmatchedBooks.length > MAX_ROWS) && (
        <div style={{ fontSize: 12, color: "var(--ink-400)" }}>
          Showing the first {MAX_ROWS} rows per tab — export the CSV for the complete list.
        </div>
      )}
    </div>
  );
}

// ── polling shell ──────────────────────────────────────────────────────────

export function Results({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Job;
        if (cancelled.current) return;
        setJob(data);
        if (!TERMINAL.includes(data.status)) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (cancelled.current) return;
        setPollErr(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    return () => { cancelled.current = true; if (timer) clearTimeout(timer); };
  }, [jobId]);

  if (pollErr) return <Card style={{ padding: 16 }}><span style={{ color: "var(--error-fg)" }}>Polling error: {pollErr}</span></Card>;
  if (!job) return <Card style={{ padding: 16, color: "var(--ink-400)" }}>Loading…</Card>;

  if (job.status === "failed") {
    return (
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--error-fg)" }}>Reconciliation failed</div>
        {job.error && <pre style={{ marginTop: 10, fontSize: 13, whiteSpace: "pre-wrap", color: "var(--error-fg)", background: "var(--error-bg)", border: "1px solid var(--error-border)", padding: 10, borderRadius: 8 }}>{job.error}</pre>}
      </Card>
    );
  }

  if (job.status !== "succeeded") {
    return (
      <Card style={{ padding: 20 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-400)" }}>job {job.id.slice(0, 8)} · {job.job_key}</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: "var(--ink-200)", marginTop: 4 }}>
          {job.status === "queued" ? "Queued…" : "Reconciling…"}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-400)", marginTop: 6 }}>Parsing your files and matching transactions.</div>
      </Card>
    );
  }

  const result = job.result as BankReconcileResult | null;
  if (!result || !result.summary) {
    return <Card style={{ padding: 16, color: "var(--ink-400)" }}>No result payload.</Card>;
  }
  return <Report r={result} />;
}
