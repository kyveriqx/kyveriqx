"use client";

/* Polls /api/jobs/[id] like the Org Ledger Reconciliation result view and
   renders the BankReconcileResult with the same visual language: balance
   tiles, a match summary, matched-groups + gaps tables, an action plan, and
   a download bar (CSV export of exceptions). */

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../core/ui/button";
import { Card } from "../../../core/ui/card";
import { JobProgress } from "../../../core/ui/job-progress";
import type { BankReconcileResult, MatchGroup, MatchMethod, UnmatchedSide, FileSource } from "../lib/types";

type JobStatusValue = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Job = {
  id: string;
  status: JobStatusValue;
  result: BankReconcileResult | null;
  error: string | null;
  updated_at: string;
  job_key: string;
};

const TERMINAL: JobStatusValue[] = ["succeeded", "failed", "cancelled"];

const inr = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METHOD_LABEL: Record<MatchMethod, string> = {
  exact: "Exact match",
  "date-tolerant": "Date-tolerant",
  "group-exact": "Grouped (e.g. UPI)",
  "group-fee": "Gateway settlement",
  settlement: "Razorpay settlement",
  reversal: "Reversal / refund",
  contra: "Contra (nets to zero)",
};

const HINT_LABEL: Record<string, string> = {
  "bank-charge": "Bank charge",
  interest: "Interest",
  tds: "TDS",
  "possible-reversal": "Possible reversal",
};

const MAX_ROWS = 300;

export function ReconcileResultView({ jobId, initialJob }: { jobId: string; initialJob?: Job }) {
  const [job, setJob] = useState<Job | null>(initialJob ?? null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (initialJob && TERMINAL.includes(initialJob.status)) return;
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as Job;
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
  }, [jobId, initialJob]);

  if (pollErr) {
    return <JobProgress stage="failed" error={`We lost connection while checking progress (${pollErr}). Please refresh the page.`} />;
  }

  if (!job) return <JobProgress stage="queued" />;

  if (job.status !== "succeeded") {
    const stage =
      job.status === "failed" ? "failed"
        : job.status === "cancelled" ? "cancelled"
          : job.status === "running" ? "running"
            : "queued";
    return <JobProgress stage={stage} error={job.error} />;
  }

  const res = job.result;
  if (!res || !res.summary) {
    return <Card style={{ padding: 24 }}>Job finished but no result was returned.</Card>;
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <BalanceTiles res={res} />
      <MatchSummary res={res} />
      <FilesMerged res={res} />
      <MatchedGroupsTable res={res} />
      <GapsSection res={res} />
      <ActionPlan res={res} />
      <DownloadBar res={res} jobId={jobId} />
    </div>
  );
}

// ── Sub-sections ────────────────────────────────────────────────────────────

function BalanceTiles({ res }: { res: BankReconcileResult }) {
  const gap = res.summary.netGap;
  const reconciled = Math.abs(gap) < 0.01;
  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center" }}>
        <Tile heading="Your bank statement" value={inr(res.summary.bankNet)} sub="net movement (credits − debits)" />
        <div style={{ color: "var(--ink-400)", fontFamily: "var(--font-mono)" }}>vs</div>
        <Tile heading="Your books say" value={inr(res.summary.booksNet)} sub="net movement (receipts − payments)" />
      </div>
      <div style={{
        marginTop: 18, padding: "14px 18px",
        background: reconciled ? "var(--success-bg)" : "var(--warn-bg)",
        border: `1px solid ${reconciled ? "var(--success-border)" : "var(--warn-border)"}`,
        borderRadius: 10, fontWeight: 600,
        color: reconciled ? "var(--success-fg)" : "var(--warn-fg)",
        fontSize: 15, textAlign: "center",
      }}>
        {reconciled
          ? "✓ Bank and books match — fully reconciled"
          : `⚠ Net gap = ${inr(gap)} — bank and books disagree by this amount`}
      </div>
    </Card>
  );
}

function Tile({ heading, value, sub }: { heading: string; value: string; sub: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.06em", color: "var(--ink-400)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{heading}</div>
      <div style={{ fontSize: 32, fontWeight: 700, marginTop: 6, color: "var(--ink-200)", letterSpacing: "-0.015em" }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--ink-300)", marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 14px", letterSpacing: "-0.01em", color: "var(--ink-200)" }}>{children}</h2>;
}

function MatchSummary({ res }: { res: BankReconcileResult }) {
  const s = res.summary;
  const methods = (Object.keys(s.byMethod) as MatchMethod[]).filter((m) => s.byMethod[m] > 0);
  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Match summary</SectionTitle>
      <Table headers={["Method", "Matches", "Bank rows", "Books rows", "Fee identified"]}>
        {methods.map((m) => {
          const groups = res.groups.filter((g) => g.method === m);
          const bankRows = groups.reduce((a, g) => a + g.bankRows.length, 0);
          const booksRows = groups.reduce((a, g) => a + g.booksRows.length, 0);
          const fee = groups.reduce((a, g) => a + g.fee, 0);
          return (
            <tr key={m}>
              <Td>{METHOD_LABEL[m]}</Td>
              <Td align="right">{s.byMethod[m]}</Td>
              <Td align="right">{bankRows}</Td>
              <Td align="right">{booksRows}</Td>
              <Td align="right">{fee ? inr(fee) : "—"}</Td>
            </tr>
          );
        })}
        {methods.length === 0 && (
          <tr><Td>No matches found</Td><Td align="right">0</Td><Td align="right">0</Td><Td align="right">0</Td><Td align="right">—</Td></tr>
        )}
      </Table>
      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13, color: "var(--ink-300)" }}>
        <Pill kind="neutral">{s.unmatchedBankCount} unmatched bank</Pill>
        <Pill kind="neutral">{s.unmatchedBooksCount} unmatched books</Pill>
        {s.feesIdentified > 0 && <Pill kind="amber">Gateway fees {inr(s.feesIdentified)}</Pill>}
        {s.bankChargesTotal > 0 && <Pill kind="amber">Bank charges {inr(s.bankChargesTotal)}</Pill>}
        {s.interestTotal > 0 && <Pill kind="ok">Interest {inr(s.interestTotal)}</Pill>}
        {s.tdsTotal > 0 && <Pill kind="amber">TDS {inr(s.tdsTotal)}</Pill>}
      </div>
    </Card>
  );
}

function SourceList({ title, items }: { title: string; items: FileSource[] }) {
  if (!items.length) return null;
  return (
    <div>
      <SubTitle>{title}</SubTitle>
      <div style={{ display: "grid", gap: 4 }}>
        {items.map((f, i) => (
          <div key={`${f.file}-${i}`} style={{ fontSize: 12.5, color: "var(--ink-200)", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{f.file}</span>
            <span style={{ color: "var(--ink-400)", fontFamily: "var(--font-mono)" }}>
              {f.rows ? `${f.rows} row${f.rows === 1 ? "" : "s"} · rows ${f.rowStart}–${f.rowEnd}` : "no rows"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Files merged" legend (only when a side has >1 file) + any pipeline
 *  warnings (overlapping periods, differing column maps). Lets a global row
 *  number in the matched-groups table be traced back to its source file. */
function FilesMerged({ res }: { res: BankReconcileResult }) {
  const s = res.sources;
  const multi = !!s && (s.bank.length > 1 || s.books.length > 1 || s.settlement.length > 1);
  const notes = res.notes ?? [];
  if (!multi && notes.length === 0) return null;
  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Files merged</SectionTitle>
      {multi && s && (
        <div style={{ display: "grid", gap: 14 }}>
          <SourceList title="Bank statement" items={s.bank} />
          <SourceList title="Books ledger" items={s.books} />
          <SourceList title="Settlement report" items={s.settlement} />
        </div>
      )}
      {notes.length > 0 && (
        <div style={{ marginTop: multi ? 16 : 0, display: "grid", gap: 8 }}>
          {notes.map((n, i) => (
            <div key={i} style={{
              fontSize: 12.5, color: "var(--warn-fg)", background: "var(--warn-bg)",
              border: "1px solid var(--warn-border)", borderRadius: 8, padding: "8px 12px",
            }}>
              ⚠ {n}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MatchedGroupsTable({ res }: { res: BankReconcileResult }) {
  if (res.groups.length === 0) return null;
  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Matched ({res.groups.length})</SectionTitle>
      <div style={{ overflowX: "auto" }}>
        <Table headers={["Method", "Bank row(s)", "Books row(s)", "Bank ₹", "Books ₹", "Fee", "Date gap", "Confidence"]}>
          {res.groups.slice(0, MAX_ROWS).map((g: MatchGroup) => (
            <tr key={g.id}>
              <Td>{METHOD_LABEL[g.method]}{g.note ? <span style={{ display: "block", fontSize: 11, color: "var(--ink-400)" }}>{g.note}</span> : null}</Td>
              <Td>{g.bankRows.join(", ") || "—"}</Td>
              <Td>{g.booksRows.join(", ") || "—"}</Td>
              <Td align="right">{inr(g.bankAmount)}</Td>
              <Td align="right">{inr(g.booksAmount)}</Td>
              <Td align="right">{g.fee ? `${inr(g.fee)}${g.feeRatePct != null ? ` (${g.feeRatePct}%)` : ""}` : "—"}</Td>
              <Td align="right">{g.dateGapDays ? `${g.dateGapDays}d` : "0"}</Td>
              <Td><Pill kind={g.confidence === "high" ? "ok" : g.confidence === "medium" ? "amber" : "neutral"}>{g.confidence}</Pill></Td>
            </tr>
          ))}
        </Table>
      </div>
    </Card>
  );
}

function rowRef(u: { file?: string; fileRow?: number; row: number }): string {
  return u.file ? `${u.file} · r${u.fileRow}` : `r${u.row}`;
}

function UnmatchedTable({ rows }: { rows: UnmatchedSide[] }) {
  return (
    <Table headers={["Source", "Date", "Description", "Debit", "Credit", "Flag"]}>
      {rows.slice(0, MAX_ROWS).map((u) => (
        <tr key={u.row}>
          <Td>{rowRef(u)}</Td>
          <Td>{u.date ?? "—"}</Td>
          <Td>{u.description || "—"}</Td>
          <Td align="right">{u.debit ? inr(u.debit) : "—"}</Td>
          <Td align="right">{u.credit ? inr(u.credit) : "—"}</Td>
          <Td>{u.hint ? <Pill kind="amber">{HINT_LABEL[u.hint]}</Pill> : "—"}</Td>
        </tr>
      ))}
    </Table>
  );
}

function GapsSection({ res }: { res: BankReconcileResult }) {
  const hasAny = res.unmatchedBank.length + res.unmatchedBooks.length > 0;
  if (!hasAny) {
    return (
      <Card style={{ padding: 24 }}>
        <SectionTitle>Gaps &amp; unmatched items</SectionTitle>
        <div style={{ color: "var(--success-fg)" }}>✓ No unmatched items — every line on both sides tied out.</div>
      </Card>
    );
  }
  return (
    <Card style={{ padding: 24, display: "grid", gap: 24 }}>
      <SectionTitle>Gaps &amp; unmatched items</SectionTitle>
      {res.unmatchedBank.length > 0 && (
        <div>
          <SubTitle>On your bank statement, not matched to books ({res.unmatchedBank.length})</SubTitle>
          <div style={{ overflowX: "auto" }}><UnmatchedTable rows={res.unmatchedBank} /></div>
        </div>
      )}
      {res.unmatchedBooks.length > 0 && (
        <div>
          <SubTitle>In your books, not seen on the bank ({res.unmatchedBooks.length})</SubTitle>
          <div style={{ overflowX: "auto" }}><UnmatchedTable rows={res.unmatchedBooks} /></div>
        </div>
      )}
    </Card>
  );
}

function ActionPlan({ res }: { res: BankReconcileResult }) {
  type Act = { pri: "URGENT" | "MEDIUM" | "FINAL"; who: string; action: string; detail: string };
  const s = res.summary;
  const actions: Act[] = [];

  if (s.feesIdentified > 0) actions.push({
    pri: "MEDIUM", who: "YOU",
    action: `Book gateway fees ${inr(s.feesIdentified)}`,
    detail: "Razorpay/POS deducted this as fee + GST before settling. Post it as a bank-charge expense (and claim the GST input credit) so your books match the net credited.",
  });
  if (s.bankChargesTotal > 0) actions.push({
    pri: "MEDIUM", who: "YOU",
    action: `Book bank charges ${inr(s.bankChargesTotal)}`,
    detail: "The bank debited these charges (SMS / maintenance / NEFT etc.) but they aren't in your books yet. Record them to close the gap.",
  });
  if (s.interestTotal > 0) actions.push({
    pri: "MEDIUM", who: "YOU",
    action: `Record interest income ${inr(s.interestTotal)}`,
    detail: "The bank credited interest not yet in your books. Record the income (and any TDS the bank deducted on it).",
  });
  if (s.tdsTotal > 0) actions.push({
    pri: "MEDIUM", who: "YOU",
    action: `Record TDS ${inr(s.tdsTotal)}`,
    detail: "Tax deducted at source by the bank. Book it and claim the credit in your return.",
  });
  if (s.unmatchedBankCount > 0) actions.push({
    pri: "URGENT", who: "YOU",
    action: `Investigate ${s.unmatchedBankCount} bank line(s) with no books match`,
    detail: "Money moved on the bank that isn't in your books. Check for missed receipts/payments or entries posted to a different ledger.",
  });
  if (s.unmatchedBooksCount > 0) actions.push({
    pri: "URGENT", who: "YOU",
    action: `Check ${s.unmatchedBooksCount} book entry(ies) not seen on the bank`,
    detail: "Entries in your books with no bank counterpart — likely uncleared cheques, a wrong bank account, or duplicates.",
  });
  actions.push({
    pri: "FINAL", who: "BOTH",
    action: "Confirm the closing balance ties out",
    detail: "Once the items above are cleared, the net gap should be zero — then sign off the reconciliation for the period.",
  });

  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Action plan</SectionTitle>
      <div style={{ display: "grid", gap: 12 }}>
        {actions.map((a, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 12, padding: 16,
            border: "1px solid var(--line-strong)", borderRadius: 10, background: "var(--bg-elev)", alignItems: "start",
          }}>
            <Pill kind={a.pri === "URGENT" ? "warn" : a.pri === "MEDIUM" ? "amber" : "ok"}>{a.pri}</Pill>
            <Pill kind="neutral">{a.who}</Pill>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink-100)" }}>{a.action}</div>
              <div style={{ marginTop: 6, fontSize: 13, color: "var(--ink-100)", opacity: 0.85, lineHeight: 1.55 }}>{a.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DownloadBar({ res, jobId }: { res: BankReconcileResult; jobId: string }) {
  function download() {
    const header = ["Side", "File", "File row", "Date", "Description", "Debit", "Credit", "Flag"];
    const esc = (v: unknown) => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const rows: (string | number)[][] = [header];
    const add = (side: string, u: UnmatchedSide) => rows.push([side, u.file ?? "", u.fileRow ?? u.row, u.date ?? "", u.description, u.debit, u.credit, u.hint ? HINT_LABEL[u.hint] : ""]);
    res.unmatchedBank.forEach((u) => add("Bank", u));
    res.unmatchedBooks.forEach((u) => add("Books", u));
    const text = rows.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "bank-reconciliation-exceptions.csv"; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Card style={{ padding: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-200)" }}>Download the reconciliation report</div>
        <div style={{ fontSize: 13, color: "var(--ink-100)", opacity: 0.75, marginTop: 4 }}>
          A formatted 6-sheet Excel report — Summary &amp; bridge · Matched · Exceptions (Bank) · Exceptions (Books) · Action Plan · Notes.
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <a href={`/api/jobs/${jobId}/report`}>
          <Button size="sm">Download Excel report</Button>
        </a>
        <Button size="sm" variant="ghost" onClick={download}>Exceptions only (CSV)</Button>
      </div>
    </Card>
  );
}

// ── Primitives (identical to orgledgerreco) ─────────────────────────────────

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} style={{
              textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--line-strong)",
              color: "var(--ink-200)", fontWeight: 700, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase",
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", textAlign: align, verticalAlign: "top", color: "var(--ink-100)" }}>
      {children}
    </td>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", color: "var(--ink-100)" }}>{children}</h3>;
}

function Pill({ kind, children }: { kind: "ok" | "warn" | "amber" | "neutral"; children: React.ReactNode }) {
  const colors = {
    ok: { bg: "var(--success-bg)", color: "var(--success-fg)", border: "var(--success-border)" },
    warn: { bg: "var(--warn-bg)", color: "var(--warn-fg)", border: "var(--warn-border)" },
    amber: { bg: "var(--amber-bg)", color: "var(--amber-fg)", border: "var(--amber-border)" },
    neutral: { bg: "var(--neutral-bg)", color: "var(--neutral-fg)", border: "var(--neutral-border)" },
  }[kind];
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.02em",
      borderRadius: "var(--radius-badge, 999px)", background: colors.bg, color: colors.color,
      border: `1px solid ${colors.border}`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}
