"use client";

/* Polls /api/jobs/[id] like JobStatus, but for the Org Ledger Reconciliation
   tool it knows the shape of `job.result` and renders the matching tables
   + a "Download Excel report" button instead of dumping JSON. */

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../core/ui/button";
import { Card } from "../../../core/ui/card";

type JobStatusValue = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type ReconcileResultJson = {
  companyClosing: number;
  partnerClosing: number;
  totalGap: number;
  companySignLabel: string;
  partnerSignLabel: string;
  matchedInvoices: Array<{
    location: string; invoiceNo: string; partnerDate: string | null; partnerAmount: number;
    companyRef: string; companyDate: string | null; companyAmount: number;
    tdsDeducted: number; amountDiff: number; netDiff: number; docType: string;
    status: "Matched" | "TDS Diff" | "Amount Mismatch";
  }>;
  matchedPayments: Array<{ location: string; companyRef: string; companyDate: string | null;
    amount: number; partnerRef: string; partnerDate: string | null; status: "Matched"; }>;
  unmatchedCompanyInv: Array<{ sheet: string; date: string | null; docType: string;
    docNo: string; extNo: string; tds: number; debit: number; credit: number; reason: string; }>;
  unmatchedPartnerInv: Array<{ location: string; date: string | null; docType: string;
    docNo: string; amount: number; reason: string; }>;
  unmatchedCompanyPay: Array<{ companyRef: string; date: string | null; amount: number; reason: string; }>;
  locationSummary: Array<{ location: string; openingBal: number; closingBal: number;
    matchedInv: number; status: "Settled" | "Outstanding"; }>;
  totalTds: number;
  companyPartyName: string;
  durationMs?: number;
  /** Parse warnings: control-total mismatches, period-bridge gaps, de-duped files. */
  notes?: string[];
  /** Source filenames per side (each side may receive several files). */
  sources?: { company: string[]; partner: string[] };
  gapAnalysis?: {
    totalGap: number;
    tdsCompanyDeducted: number;
    tdsPartnerCredited: number;
    tdsNet: number;
    cutoffItems: Array<{ side: "company" | "partner"; location: string; ref: string; date: string | null; amount: number }>;
    cutoffTotal: number;
    companyLastDate: string | null;
    partnerLastDate: string | null;
    matchedInvoiceCount: number;
    amountDateMatchedCount: number;
  };
};

export type Job = {
  id: string;
  status: JobStatusValue;
  result: ReconcileResultJson | null;
  error: string | null;
  updated_at: string;
  job_key: string;
};

const TERMINAL: JobStatusValue[] = ["succeeded", "failed", "cancelled"];

const inr = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateStr = (d: string | null | undefined) => (d ? d.slice(0, 10) : "");

export function ReconcileResultView({
  jobId,
  initialJob,
}: {
  jobId: string;
  initialJob?: Job;
}) {
  const [job, setJob] = useState<Job | null>(initialJob ?? null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    // Inline pipeline: the page seeds initialJob with a terminal state, so
    // there's nothing to poll for. Skip the effect entirely. Other tools
    // (queued via Trigger.dev) still come through without initialJob and
    // hit the poll loop below.
    if (initialJob && TERMINAL.includes(initialJob.status)) {
      return;
    }

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
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, initialJob]);

  if (pollErr) {
    return (
      <div style={{ color: "var(--error-fg)", padding: 16,
        border: "1px solid var(--error-border)", background: "var(--error-bg)",
        borderRadius: 10 }}>
        Polling error: {pollErr}
      </div>
    );
  }

  if (!job) return <div style={{ color: "var(--ink-400)", padding: 16 }}>Loading…</div>;

  if (job.status !== "succeeded") {
    const labels: Record<JobStatusValue, string> = {
      queued: "Queued — waiting for a worker", running: "Running — parsing & matching…",
      succeeded: "Done", failed: "Failed", cancelled: "Cancelled",
    };
    return (
      <Card style={{ padding: 24 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-400)" }}>
          job {job.id.slice(0, 8)} · {job.job_key}
        </div>
        <div style={{
          fontSize: 22, fontWeight: 600, marginTop: 4,
          color: job.status === "failed" ? "var(--error-fg)" : "var(--ink-200)",
        }}>
          {labels[job.status]}
        </div>
        {job.error && (
          <pre style={{
            color: "var(--error-fg)", marginTop: 12, fontSize: 13,
            background: "var(--error-bg)", border: "1px solid var(--error-border)",
            padding: 10, borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}>{job.error}</pre>
        )}
      </Card>
    );
  }

  const res = job.result;
  if (!res) {
    return <Card style={{ padding: 24 }}>Job finished but no result was returned.</Card>;
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <BalanceTiles res={res} />
      <NotesBanner res={res} />
      <GapAnalysisSection res={res} />
      <LocationSummary res={res} />
      <MatchedInvoicesTable res={res} />
      <GapsSection res={res} />
      <ActionPlan res={res} />
      <DownloadBar jobId={job.id} />
    </div>
  );
}

// ── Sub-sections ────────────────────────────────────────────────────────────

function BalanceTiles({ res }: { res: ReconcileResultJson }) {
  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center" }}>
        <Tile heading="Your books say" value={inr(res.companyClosing)} sub={res.companySignLabel} />
        <div style={{ color: "var(--ink-400)", fontFamily: "var(--font-mono)" }}>vs</div>
        <Tile heading="Partner's books say" value={inr(res.partnerClosing)} sub={res.partnerSignLabel} />
      </div>
      <div style={{
        marginTop: 18, padding: "14px 18px",
        background: res.totalGap === 0 ? "var(--success-bg)" : "var(--warn-bg)",
        border: `1px solid ${res.totalGap === 0 ? "var(--success-border)" : "var(--warn-border)"}`,
        borderRadius: 10, fontWeight: 600,
        color: res.totalGap === 0 ? "var(--success-fg)" : "var(--warn-fg)",
        fontSize: 15, textAlign: "center",
      }}>
        {res.totalGap === 0
          ? "✓ Both books match — fully reconciled"
          : `⚠ Total gap = ${inr(res.totalGap)} — both books disagree by this amount`}
      </div>
    </Card>
  );
}

function GapAnalysisSection({ res }: { res: ReconcileResultJson }) {
  const ga = res.gapAnalysis;
  if (!ga || res.totalGap === 0) return null;
  const tdsNetSmall = Math.abs(ga.tdsNet) < Math.max(5000, ga.totalGap * 0.5);
  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Why the books differ</SectionTitle>
      <div style={{ display: "grid", gap: 10, fontSize: 13.5, color: "var(--ink-200)", lineHeight: 1.55 }}>
        <Line
          label="TDS"
          value={`You deducted ${inr(ga.tdsCompanyDeducted)}; partner credited ${inr(ga.tdsPartnerCredited)} → net ${inr(ga.tdsNet)}`}
          note={tdsNetSmall ? "TDS largely nets out — not the main cause." : "TDS difference is material — chase the missing TDS credit."}
        />
        {ga.cutoffItems.length > 0 && (
          <Line
            label="Cut-off / timing"
            value={`${ga.cutoffItems.length} entr${ga.cutoffItems.length > 1 ? "ies" : "y"} totalling ${inr(ga.cutoffTotal)} fall outside the other book's date range`}
            note={`Your last entry ${dateStr(ga.companyLastDate)} · partner's last entry ${dateStr(ga.partnerLastDate)} — re-run with the same end date to remove this.`}
          />
        )}
        <Line
          label="Match coverage"
          value={`${ga.matchedInvoiceCount} invoices matched (${ga.amountDateMatchedCount} by amount+date where invoice numbers differ)`}
        />
      </div>
      {ga.cutoffItems.length > 0 && (
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["Side", "Location", "Reference", "Date", "Amount"].map((h) => (
                  <th key={h} style={{ textAlign: h === "Amount" ? "right" : "left", padding: "6px 10px",
                    borderBottom: "1px solid var(--line)", color: "var(--ink-400)", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ga.cutoffItems.slice(0, 12).map((c, i) => (
                <tr key={i}>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>{c.side === "company" ? "Your books" : "Partner"}</td>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>{c.location}</td>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>{c.ref}</td>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)" }}>{dateStr(c.date)}</td>
                  <td style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", textAlign: "right", fontFamily: "var(--font-mono)" }}>{inr(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Line({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
      <span style={{ minWidth: 130, fontWeight: 600, color: "var(--ink-300)" }}>{label}</span>
      <span style={{ flex: 1, minWidth: 240 }}>
        {value}
        {note && <span style={{ display: "block", fontSize: 12, color: "var(--ink-400)", marginTop: 2 }}>{note}</span>}
      </span>
    </div>
  );
}

function NotesBanner({ res }: { res: ReconcileResultJson }) {
  const notes = res.notes ?? [];
  if (!notes.length) return null;
  return (
    <Card style={{ padding: "16px 20px", background: "var(--accent-bg-soft)", border: "1px solid var(--accent-border-soft)" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.06em", color: "var(--ink-400)",
        fontFamily: "var(--font-mono)", textTransform: "uppercase", marginBottom: 8 }}>
        Parsing notes
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {notes.map((n, i) => (
          <li key={i} style={{ fontSize: 13, color: "var(--ink-200)", lineHeight: 1.5 }}>{n}</li>
        ))}
      </ul>
    </Card>
  );
}

function Tile({ heading, value, sub }: { heading: string; value: string; sub: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.06em", color: "var(--ink-400)",
        fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{heading}</div>
      <div style={{
        fontSize: 32,
        fontWeight: 700,
        marginTop: 6,
        color: "var(--ink-200)",
        letterSpacing: "-0.015em",
      }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--ink-300)", marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 18, fontWeight: 600, margin: "0 0 14px",
      letterSpacing: "-0.01em",
      color: "var(--ink-200)",
    }}>{children}</h2>
  );
}

function LocationSummary({ res }: { res: ReconcileResultJson }) {
  if (res.locationSummary.length === 0) return null;
  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Business partner location status</SectionTitle>
      <Table headers={["Location", "Opening", "Closing", "Matched", "Status"]}>
        {res.locationSummary.map((loc) => (
          <tr key={loc.location}>
            <Td>{loc.location}</Td>
            <Td align="right">{inr(loc.openingBal)}</Td>
            <Td align="right">{inr(loc.closingBal)}</Td>
            <Td align="right">{loc.matchedInv}</Td>
            <Td>
              <Pill kind={loc.status === "Settled" ? "ok" : "warn"}>
                {loc.status === "Settled" ? "✓ Settled" : "✗ Outstanding"}
              </Pill>
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function MatchedInvoicesTable({ res }: { res: ReconcileResultJson }) {
  if (res.matchedInvoices.length === 0) return null;
  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Matched invoices ({res.matchedInvoices.length})</SectionTitle>
      <div style={{ overflowX: "auto" }}>
        <Table headers={["Location", "Partner Inv", "Partner Date", "Partner ₹",
          "Your Ref", "Your Date", "Your ₹", "TDS", "Diff", "Status"]}>
          {res.matchedInvoices.map((m, i) => (
            <tr key={`${m.invoiceNo}-${i}`}>
              <Td>{m.location}</Td>
              <Td>{m.invoiceNo}</Td>
              <Td>{dateStr(m.partnerDate)}</Td>
              <Td align="right">{inr(m.partnerAmount)}</Td>
              <Td>{m.companyRef}</Td>
              <Td>{dateStr(m.companyDate)}</Td>
              <Td align="right">{inr(m.companyAmount)}</Td>
              <Td align="right">{m.tdsDeducted ? inr(m.tdsDeducted) : "—"}</Td>
              <Td align="right">{m.amountDiff ? inr(m.amountDiff) : "—"}</Td>
              <Td>
                <Pill kind={m.status === "Matched" ? "ok" : m.status === "TDS Diff" ? "amber" : "warn"}>
                  {m.status}
                </Pill>
              </Td>
            </tr>
          ))}
        </Table>
      </div>
    </Card>
  );
}

function GapsSection({ res }: { res: ReconcileResultJson }) {
  const hasAny = res.unmatchedCompanyPay.length + res.unmatchedCompanyInv.length + res.unmatchedPartnerInv.length > 0;
  if (!hasAny) {
    return (
      <Card style={{ padding: 24 }}>
        <SectionTitle>Gaps & unmatched items</SectionTitle>
        <div style={{ color: "var(--success-fg)" }}>✓ No unmatched items found — all records reconciled.</div>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 24, display: "grid", gap: 24 }}>
      <SectionTitle>Gaps & unmatched items</SectionTitle>

      {res.unmatchedCompanyPay.length > 0 && (
        <div>
          <SubTitle>Payments in your books, not in partner's ({res.unmatchedCompanyPay.length})</SubTitle>
          <Table headers={["Your Ref", "Date", "Amount", "Reason"]}>
            {res.unmatchedCompanyPay.map((p, i) => (
              <tr key={`${p.companyRef}-${i}`}>
                <Td>{p.companyRef}</Td>
                <Td>{dateStr(p.date)}</Td>
                <Td align="right">{inr(p.amount)}</Td>
                <Td>{p.reason}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {res.unmatchedCompanyInv.length > 0 && (
        <div>
          <SubTitle>Invoices in your books, not in partner's ({res.unmatchedCompanyInv.length})</SubTitle>
          <Table headers={["Your Ref", "Date", "Amount", "Partner Ref", "Reason"]}>
            {res.unmatchedCompanyInv.map((g, i) => (
              <tr key={`${g.docNo}-${i}`}>
                <Td>{g.docNo}</Td>
                <Td>{dateStr(g.date)}</Td>
                <Td align="right">{inr(g.credit)}</Td>
                <Td>{g.extNo || "—"}</Td>
                <Td>{g.reason}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {res.unmatchedPartnerInv.length > 0 && (
        <div>
          <SubTitle>Invoices in partner's books, not in yours ({res.unmatchedPartnerInv.length})</SubTitle>
          <Table headers={["Partner Inv", "Location", "Date", "Amount", "Reason"]}>
            {res.unmatchedPartnerInv.map((v, i) => (
              <tr key={`${v.docNo}-${i}`}>
                <Td>{v.docNo}</Td>
                <Td>{v.location}</Td>
                <Td>{dateStr(v.date)}</Td>
                <Td align="right">{inr(v.amount)}</Td>
                <Td>{v.reason}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}

function ActionPlan({ res }: { res: ReconcileResultJson }) {
  type Act = { pri: "URGENT" | "MEDIUM" | "FINAL"; who: string; action: string; detail: string };
  const actions: Act[] = [];

  for (const p of res.unmatchedCompanyPay) {
    actions.push({
      pri: "URGENT", who: "YOU",
      action: `Confirm payment ${inr(p.amount)} (${p.companyRef})`,
      detail: "Collect bank UTR/transfer receipt. Send proof to the Business Partner and ask them to record it in their books.",
    });
  }
  if (res.unmatchedPartnerInv.length > 0) {
    actions.push({
      pri: "URGENT", who: "PARTNER",
      action: "Partner to check invoices not in your books",
      detail: `${res.unmatchedPartnerInv.length} partner invoice(s) not found in your records. Ask them to share these invoices and verify if they should be booked.`,
    });
  }
  if (res.unmatchedCompanyInv.length > 0) {
    actions.push({
      pri: "MEDIUM", who: "YOU",
      action: "Check your invoices with no partner match",
      detail: `${res.unmatchedCompanyInv.length} invoice(s) in your books have no matching partner record. Verify the partner's invoice number was entered correctly.`,
    });
  }
  const tdsItems = res.matchedInvoices.filter((m) => m.tdsDeducted > 0);
  if (tdsItems.length > 0) {
    const totalTds = tdsItems.reduce((s, m) => s + m.tdsDeducted, 0);
    actions.push({
      pri: "MEDIUM", who: "PARTNER",
      action: `Partner to post TDS offset journal entries (${inr(totalTds)})`,
      detail: `TDS of ${inr(totalTds)} across ${tdsItems.length} invoice(s). Partner must post TDS credit journal vouchers (one per invoice). Share Form 16A.`,
    });
    actions.push({
      pri: "MEDIUM", who: "YOU",
      action: "Issue TDS Certificate (Form 16A) to partner",
      detail: "Generate Form 16A for all TDS deducted and share with the partner officially.",
    });
  }
  actions.push({
    pri: "FINAL", who: "BOTH",
    action: "Exchange signed ledger confirmation letters",
    detail: "Once all gaps are resolved, both parties to confirm the agreed balance in writing.",
  });

  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Action plan</SectionTitle>
      <div style={{ display: "grid", gap: 12 }}>
        {actions.map((a, i) => (
          <div key={i} style={{
            display: "grid",
            gridTemplateColumns: "auto auto 1fr",
            gap: 12,
            padding: 16,
            border: "1px solid var(--line-strong)",
            borderRadius: 10,
            background: "var(--bg-elev)",
            alignItems: "start",
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

function DownloadBar({ jobId }: { jobId: string }) {
  return (
    <Card style={{ padding: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-200)" }}>
          Need to share this with finance / your partner?
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-100)", opacity: 0.75, marginTop: 4 }}>
          Get the same result as a formatted 4-sheet Excel report (Summary · Matched · Gaps · Action Plan).
        </div>
      </div>
      <a href={`/api/jobs/${jobId}/report`}>
        <Button size="sm">Download Excel report</Button>
      </a>
    </Card>
  );
}

// ── Primitives ──────────────────────────────────────────────────────────────

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} style={{
              textAlign: "left", padding: "10px 12px",
              borderBottom: "1px solid var(--line-strong)",
              color: "var(--ink-200)", fontWeight: 700,
              fontSize: 12, letterSpacing: "0.04em",
              textTransform: "uppercase",
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
    <td style={{
      padding: "10px 12px",
      borderBottom: "1px solid var(--line)",
      textAlign: align,
      verticalAlign: "top",
      color: "var(--ink-100)",
    }}>{children}</td>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", color: "var(--ink-100)" }}>
      {children}
    </h3>
  );
}

function Pill({ kind, children }: {
  kind: "ok" | "warn" | "amber" | "neutral";
  children: React.ReactNode;
}) {
  const colors = {
    ok:      { bg: "var(--success-bg)", color: "var(--success-fg)", border: "var(--success-border)" },
    warn:    { bg: "var(--warn-bg)",    color: "var(--warn-fg)",    border: "var(--warn-border)"    },
    amber:   { bg: "var(--amber-bg)",   color: "var(--amber-fg)",   border: "var(--amber-border)"   },
    neutral: { bg: "var(--neutral-bg)", color: "var(--neutral-fg)", border: "var(--neutral-border)" },
  }[kind];
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 9px",
      fontSize: 11.5,
      fontWeight: 600,
      letterSpacing: "0.02em",
      borderRadius: "var(--radius-badge, 999px)",
      background: colors.bg,
      color: colors.color,
      border: `1px solid ${colors.border}`,
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}
