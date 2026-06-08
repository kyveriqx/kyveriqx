"use client";

/* Polls /api/jobs/[id] like the bank-ledger result view and renders the
   GstReconcileResult as 3 tabs:
     Tab 1 — ITC at Risk: KPI tiles + exceptions table (the headline)
     Tab 2 — Sales reco: GSTR-1 vs Sales Register
     Tab 3 — Suppliers: per-GSTIN rollup, sorted by tax-at-risk

   Each tab has its own "Download CSV" — the exception lists for tabs 1
   and 2, the rollup for tab 3. Action plan at the bottom of tab 1
   tells the user what to do about the gaps. */

import { useEffect, useRef, useState } from "react";
import { track } from "../../../core/lib/track";
import { Button } from "../../../core/ui/button";
import { Card } from "../../../core/ui/card";
import { JobProgress } from "../../../core/ui/job-progress";
import type {
  GstReconcileResult, ItcException, ItcExceptionKind,
  SalesException, SupplierRollup,
} from "../lib/types";

type JobStatusValue = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Job = {
  id: string;
  status: JobStatusValue;
  result: GstReconcileResult | null;
  error: string | null;
  updated_at: string;
  job_key: string;
};

const TERMINAL: JobStatusValue[] = ["succeeded", "failed", "cancelled"];

const inr = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ITC_KIND_LABEL: Record<ItcExceptionKind, string> = {
  "missing-in-2b": "Missing in 2B",
  "missing-in-books": "Missing in books",
  "gstin-mismatch": "GSTIN mismatch",
  "value-diff": "Taxable value diff",
  "tax-diff": "Tax amount diff",
  "date-diff": "Invoice date diff",
  "invoice-no-diff": "Invoice no diff",
};

const SALES_KIND_LABEL: Record<SalesException["kind"], string> = {
  "missing-in-gstr1": "Missing in GSTR-1",
  "missing-in-books": "Missing in books",
  "gstin-mismatch": "GSTIN mismatch",
  "value-diff": "Taxable value diff",
  "tax-diff": "Tax amount diff",
  "date-diff": "Invoice date diff",
  "invoice-no-diff": "Invoice no diff",
};

const MAX_ROWS = 300;

type Tab = "itc" | "sales" | "suppliers";

export function ReconcileResultView({ jobId, initialJob }: { jobId: string; initialJob?: Job }) {
  const [job, setJob] = useState<Job | null>(initialJob ?? null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("itc");
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

  // Activity log: the user actually saw a finished report (vs. only running it).
  const viewed = useRef(false);
  useEffect(() => {
    if (job?.status === "succeeded" && !viewed.current) {
      viewed.current = true;
      track("report_view", { jobId });
    }
  }, [job?.status, jobId]);

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
      <Tabs current={tab} onChange={setTab} res={res} />
      <ReportBar jobId={jobId} res={res} tab={tab} />
      {tab === "itc" && <ItcTab res={res} />}
      {tab === "sales" && <SalesTab res={res} />}
      {tab === "suppliers" && <SuppliersTab res={res} />}
      <NotesCard res={res} />
    </div>
  );
}

// ── Excel report download (whole workbook) ───────────────────────────────────

function ReportBar({ jobId, res, tab }: { jobId: string; res: GstReconcileResult; tab: Tab }) {
  const csv =
    tab === "itc" ? { label: "ITC exceptions", fn: () => downloadItcCsv(res) }
      : tab === "sales" ? { label: "Sales exceptions", fn: () => downloadSalesCsv(res) }
        : { label: "Supplier rollup", fn: () => downloadSuppliersCsv(res) };
  return (
    <Card style={{ padding: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-200)" }}>Download the reconciliation report</div>
        <div style={{ fontSize: 13, color: "var(--ink-100)", opacity: 0.75, marginTop: 4 }}>
          A formatted multi-sheet Excel workbook (all tabs), or the current view — {csv.label} — as a CSV.
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <a href={`/api/jobs/${jobId}/report`} style={{ textDecoration: "none" }}>
          <Button size="sm">Download Excel report</Button>
        </a>
        <Button size="sm" variant="ghost" onClick={csv.fn}>Download CSV</Button>
      </div>
    </Card>
  );
}

// ── Tabs nav ─────────────────────────────────────────────────────────────

function Tabs({ current, onChange, res }: { current: Tab; onChange: (t: Tab) => void; res: GstReconcileResult }) {
  const s = res.summary;
  const items: { key: Tab; label: string; count: number; tone: "warn" | "ok" | "neutral" }[] = [
    { key: "itc", label: "ITC at Risk", count: res.itcExceptions.length, tone: res.itcExceptions.length > 0 ? "warn" : "ok" },
    { key: "sales", label: "Sales reconciliation", count: res.salesExceptions.length, tone: res.salesExceptions.length > 0 ? "warn" : (s.salesInvoiceCount + s.gstr1InvoiceCount > 0 ? "ok" : "neutral") },
    { key: "suppliers", label: "Supplier filing status", count: res.supplierRollup.length, tone: "neutral" },
  ];
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {items.map((it) => {
        const active = current === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            style={{
              padding: "10px 16px",
              border: `1px solid ${active ? "var(--accent)" : "var(--line-strong)"}`,
              borderRadius: "var(--radius-md)",
              background: active ? "var(--accent-bg-soft)" : "var(--bg-elev)",
              color: active ? "var(--ink-100)" : "var(--ink-200)",
              fontSize: 13, fontWeight: active ? 700 : 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            {it.label}
            <Pill kind={it.tone === "warn" ? "warn" : it.tone === "ok" ? "ok" : "neutral"}>{it.count}</Pill>
          </button>
        );
      })}
    </div>
  );
}

// ── ITC tab ──────────────────────────────────────────────────────────────

function ItcTab({ res }: { res: GstReconcileResult }) {
  const s = res.summary;
  return (
    <>
      <Card style={{ padding: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, alignItems: "stretch" }}>
          <KpiTile heading="Invoices in books" value={String(s.purchaseInvoiceCount)} sub="from your Purchase Register" tone="neutral" />
          <KpiTile heading="ITC matched" value={inr(s.itcTaxMatched)} sub={`${s.itcMatched} invoice${s.itcMatched === 1 ? "" : "s"} tied out`} tone="ok" />
          <KpiTile heading="Tax at risk" value={inr(s.itcTaxAtRisk)} sub={`${res.itcExceptions.length} exception${res.itcExceptions.length === 1 ? "" : "s"}`} tone={s.itcTaxAtRisk > 0 ? "warn" : "ok"} />
          <KpiTile heading="Taxable value at risk" value={inr(s.itcTaxableAtRisk)} sub="across all exceptions" tone={s.itcTaxableAtRisk > 0 ? "warn" : "ok"} />
        </div>
      </Card>

      <Card style={{ padding: 24 }}>
        <SectionTitle>Breakdown by exception type</SectionTitle>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(Object.keys(s.itcExceptionsByKind) as ItcExceptionKind[])
            .filter((k) => s.itcExceptionsByKind[k] > 0)
            .map((k) => (
              <Pill key={k} kind={kindPillKind(k)}>{ITC_KIND_LABEL[k]} · {s.itcExceptionsByKind[k]}</Pill>
            ))}
          {res.itcExceptions.length === 0 && <Pill kind="ok">No exceptions — every invoice tied out</Pill>}
        </div>
      </Card>

      {res.itcExceptions.length > 0 && (
        <Card style={{ padding: 24 }}>
          <SectionTitle>ITC exceptions ({res.itcExceptions.length})</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <Table headers={["Kind", "GSTIN", "Supplier", "Invoice No", "Date", "Taxable ₹", "Tax ₹", "At risk ₹", "Notes"]}>
              {res.itcExceptions.slice(0, MAX_ROWS).map((e: ItcException, i) => {
                const ref = e.books ?? e.twoB;
                return (
                  <tr key={i}>
                    <Td><Pill kind={kindPillKind(e.kind)}>{ITC_KIND_LABEL[e.kind]}</Pill></Td>
                    <Td><code style={{ fontSize: 12 }}>{ref?.partyGstin || "—"}</code></Td>
                    <Td>{ref?.partyName || "—"}</Td>
                    <Td>{ref?.invoiceNo || "—"}</Td>
                    <Td>{ymd(ref?.invoiceDate ?? null)}</Td>
                    <Td align="right">{ref ? inr(ref.taxableValue) : "—"}</Td>
                    <Td align="right">{ref ? inr(ref.totalTax) : "—"}</Td>
                    <Td align="right">{inr(e.taxAtRisk)}</Td>
                    <Td><span style={{ fontSize: 12, color: "var(--ink-300)" }}>{e.note}</span></Td>
                  </tr>
                );
              })}
            </Table>
          </div>
          {res.itcExceptions.length > MAX_ROWS && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-400)" }}>
              Showing first {MAX_ROWS} of {res.itcExceptions.length}. Download CSV for the full list.
            </div>
          )}
        </Card>
      )}

      <ItcActionPlan res={res} />
    </>
  );
}

function ItcActionPlan({ res }: { res: GstReconcileResult }) {
  const s = res.summary;
  type Act = { pri: "URGENT" | "MEDIUM" | "FINAL"; action: string; detail: string };
  const acts: Act[] = [];
  if (s.itcExceptionsByKind["missing-in-2b"] > 0) acts.push({
    pri: "URGENT",
    action: `Chase ${s.itcExceptionsByKind["missing-in-2b"]} suppliers whose invoice isn't in 2B`,
    detail: "These are the invoices most at risk — until the supplier files, you cannot claim the ITC. Email them; check Tab 3 for who needs chasing.",
  });
  if (s.itcExceptionsByKind["gstin-mismatch"] > 0) acts.push({
    pri: "URGENT",
    action: `Fix ${s.itcExceptionsByKind["gstin-mismatch"]} GSTIN mismatches in your books`,
    detail: "The 2B shows the invoice but against a different supplier GSTIN. Almost always a typo in your purchase register — correct the GSTIN and re-run.",
  });
  if (s.itcExceptionsByKind["value-diff"] + s.itcExceptionsByKind["tax-diff"] > 0) acts.push({
    pri: "MEDIUM",
    action: `Reconcile ${s.itcExceptionsByKind["value-diff"] + s.itcExceptionsByKind["tax-diff"]} value/tax diffs`,
    detail: "The supplier filed a different amount than what's in your books. Decide which is right — supplier may need to amend, or your booking may need to change.",
  });
  if (s.itcExceptionsByKind["date-diff"] > 0) acts.push({
    pri: "MEDIUM",
    action: `Review ${s.itcExceptionsByKind["date-diff"]} invoice-date mismatches`,
    detail: "Invoice numbers and amounts match but dates differ beyond the tolerance window — usually a typo, occasionally a re-issued invoice.",
  });
  if (s.itcExceptionsByKind["missing-in-books"] > 0) acts.push({
    pri: "MEDIUM",
    action: `Investigate ${s.itcExceptionsByKind["missing-in-books"]} 2B invoices not in your books`,
    detail: "Supplier reported a sale to your GSTIN that you don't have on record. Either a missed purchase entry or — risky — a supplier mis-filing using your GSTIN.",
  });
  acts.push({
    pri: "FINAL",
    action: "Re-run after fixes and lock the period",
    detail: "Once the table above is empty (or down to acceptable items), the ITC reconciliation for this period is good to sign off.",
  });

  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Action plan</SectionTitle>
      <div style={{ display: "grid", gap: 12 }}>
        {acts.map((a, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, padding: 16,
            border: "1px solid var(--line-strong)", borderRadius: 10, background: "var(--bg-elev)", alignItems: "start",
          }}>
            <Pill kind={a.pri === "URGENT" ? "warn" : a.pri === "MEDIUM" ? "amber" : "ok"}>{a.pri}</Pill>
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

// ── Sales tab ────────────────────────────────────────────────────────────

function SalesTab({ res }: { res: GstReconcileResult }) {
  const s = res.summary;
  if (s.gstr1InvoiceCount + s.salesInvoiceCount === 0) {
    return (
      <Card style={{ padding: 24, color: "var(--ink-300)" }}>
        Sales reconciliation skipped — neither GSTR-1 nor a Sales Register was uploaded. Add them in Step 2 of the upload form to enable this tab.
      </Card>
    );
  }
  return (
    <>
      <Card style={{ padding: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
          <KpiTile heading="Sales in books" value={String(s.salesInvoiceCount)} sub="from your Sales Register" tone="neutral" />
          <KpiTile heading="In GSTR-1" value={String(s.gstr1InvoiceCount)} sub="invoices you filed" tone="neutral" />
          <KpiTile heading="Matched" value={String(s.salesMatched)} sub="books ↔ GSTR-1" tone="ok" />
          <KpiTile heading="Tax at risk" value={inr(s.salesTaxAtRisk)} sub={`${res.salesExceptions.length} exception${res.salesExceptions.length === 1 ? "" : "s"}`} tone={s.salesTaxAtRisk > 0 ? "warn" : "ok"} />
        </div>
      </Card>

      {res.salesExceptions.length > 0 && (
        <Card style={{ padding: 24 }}>
          <SectionTitle>Sales exceptions ({res.salesExceptions.length})</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <Table headers={["Kind", "Customer GSTIN", "Customer", "Invoice No", "Date", "Taxable ₹", "Tax ₹", "At risk ₹", "Notes"]}>
              {res.salesExceptions.slice(0, MAX_ROWS).map((e, i) => {
                const ref = e.books ?? e.gstr1;
                return (
                  <tr key={i}>
                    <Td><Pill kind={salesKindPillKind(e.kind)}>{SALES_KIND_LABEL[e.kind]}</Pill></Td>
                    <Td><code style={{ fontSize: 12 }}>{ref?.partyGstin || "—"}</code></Td>
                    <Td>{ref?.partyName || "—"}</Td>
                    <Td>{ref?.invoiceNo || "—"}</Td>
                    <Td>{ymd(ref?.invoiceDate ?? null)}</Td>
                    <Td align="right">{ref ? inr(ref.taxableValue) : "—"}</Td>
                    <Td align="right">{ref ? inr(ref.totalTax) : "—"}</Td>
                    <Td align="right">{inr(e.taxAtRisk)}</Td>
                    <Td><span style={{ fontSize: 12, color: "var(--ink-300)" }}>{e.note}</span></Td>
                  </tr>
                );
              })}
            </Table>
          </div>
        </Card>
      )}

      {res.salesExceptions.length === 0 && (
        <Card style={{ padding: 24, color: "var(--success-fg)" }}>
          ✓ Every sales invoice ties between your books and GSTR-1.
        </Card>
      )}
    </>
  );
}

// ── Suppliers tab ────────────────────────────────────────────────────────

function SuppliersTab({ res }: { res: GstReconcileResult }) {
  if (res.supplierRollup.length === 0) {
    return (
      <Card style={{ padding: 24, color: "var(--ink-300)" }}>
        No supplier rollup — upload GSTR-2B and a Purchase Register to populate this tab. Adding GSTR-2A unlocks the "filed late" column.
      </Card>
    );
  }
  return (
    <>
      <Card style={{ padding: 24 }}>
        <SectionTitle>Suppliers ({res.supplierRollup.length}) — sorted by tax at risk</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <Table headers={["GSTIN", "Supplier", "Books ₹ tax", "2B ₹ tax", "Filed late (2A only)", "Tax at risk"]}>
            {res.supplierRollup.slice(0, MAX_ROWS).map((r: SupplierRollup) => (
              <tr key={r.gstin}>
                <Td><code style={{ fontSize: 12 }}>{r.gstin}</code></Td>
                <Td>
                  {r.name || <span style={{ color: "var(--ink-400)" }}>(no name on file)</span>}
                  <div style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 2 }}>
                    {r.booksInvoiceCount} books · {r.twoBInvoiceCount} in 2B
                  </div>
                </Td>
                <Td align="right">{inr(r.booksTaxAmount)}</Td>
                <Td align="right">{inr(r.twoBTaxAmount)}</Td>
                <Td align="right">{r.filedLateInvoiceCount > 0 ? `${r.filedLateInvoiceCount} · ${inr(r.filedLateTaxAmount)}` : "—"}</Td>
                <Td align="right"><span style={{ color: r.taxAtRisk > 0 ? "var(--warn-fg)" : "var(--success-fg)", fontWeight: 700 }}>{inr(r.taxAtRisk)}</span></Td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>

    </>
  );
}

// ── Pipeline warnings ────────────────────────────────────────────────────

function NotesCard({ res }: { res: GstReconcileResult }) {
  if (!res.notes || res.notes.length === 0) return null;
  return (
    <Card style={{ padding: 24 }}>
      <SectionTitle>Pipeline notes</SectionTitle>
      <div style={{ display: "grid", gap: 8 }}>
        {res.notes.map((n, i) => (
          <div key={i} style={{
            fontSize: 12.5, color: "var(--warn-fg)", background: "var(--warn-bg)",
            border: "1px solid var(--warn-border)", borderRadius: 8, padding: "8px 12px",
          }}>
            ⚠ {n}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── CSV exports ──────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  const x = String(v ?? "");
  return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  track("report_download", { metadata: { format: "csv", filename } });
}

function downloadItcCsv(res: GstReconcileResult) {
  const rows: (string | number)[][] = [
    ["Kind", "Books file", "Books row", "2B file", "2B row", "GSTIN", "Supplier", "Invoice No", "Books Date", "2B Date", "Books Taxable", "2B Taxable", "Books Tax", "2B Tax", "Tax at risk", "Note"],
  ];
  for (const e of res.itcExceptions) {
    rows.push([
      ITC_KIND_LABEL[e.kind],
      e.books?.file ?? "", e.books?.fileRow ?? "",
      e.twoB?.file ?? "", e.twoB?.fileRow ?? "",
      (e.books ?? e.twoB)?.partyGstin ?? "",
      (e.books ?? e.twoB)?.partyName ?? "",
      (e.books ?? e.twoB)?.invoiceNo ?? "",
      ymd(e.books?.invoiceDate ?? null) ?? "",
      ymd(e.twoB?.invoiceDate ?? null) ?? "",
      e.books?.taxableValue ?? "",
      e.twoB?.taxableValue ?? "",
      e.books?.totalTax ?? "",
      e.twoB?.totalTax ?? "",
      e.taxAtRisk,
      e.note,
    ]);
  }
  downloadCsv("gst-itc-exceptions.csv", rows);
}

function downloadSalesCsv(res: GstReconcileResult) {
  const rows: (string | number)[][] = [
    ["Kind", "Books file", "Books row", "GSTR-1 file", "GSTR-1 row", "Customer GSTIN", "Customer", "Invoice No", "Books Date", "GSTR-1 Date", "Books Taxable", "GSTR-1 Taxable", "Books Tax", "GSTR-1 Tax", "Tax at risk", "Note"],
  ];
  for (const e of res.salesExceptions) {
    rows.push([
      SALES_KIND_LABEL[e.kind],
      e.books?.file ?? "", e.books?.fileRow ?? "",
      e.gstr1?.file ?? "", e.gstr1?.fileRow ?? "",
      (e.books ?? e.gstr1)?.partyGstin ?? "",
      (e.books ?? e.gstr1)?.partyName ?? "",
      (e.books ?? e.gstr1)?.invoiceNo ?? "",
      ymd(e.books?.invoiceDate ?? null) ?? "",
      ymd(e.gstr1?.invoiceDate ?? null) ?? "",
      e.books?.taxableValue ?? "",
      e.gstr1?.taxableValue ?? "",
      e.books?.totalTax ?? "",
      e.gstr1?.totalTax ?? "",
      e.taxAtRisk,
      e.note,
    ]);
  }
  downloadCsv("gst-sales-exceptions.csv", rows);
}

function downloadSuppliersCsv(res: GstReconcileResult) {
  const rows: (string | number)[][] = [
    ["GSTIN", "Supplier", "Books invoices", "Books taxable", "Books tax", "2B invoices", "2B taxable", "2B tax", "Filed-late invoices (2A only)", "Filed-late tax", "Tax at risk"],
  ];
  for (const s of res.supplierRollup) {
    rows.push([
      s.gstin, s.name,
      s.booksInvoiceCount, s.booksTaxableValue, s.booksTaxAmount,
      s.twoBInvoiceCount, s.twoBTaxableValue, s.twoBTaxAmount,
      s.filedLateInvoiceCount, s.filedLateTaxAmount, s.taxAtRisk,
    ]);
  }
  downloadCsv("gst-supplier-rollup.csv", rows);
}

// ── Primitives ───────────────────────────────────────────────────────────

function ymd(d: Date | null): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const da = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function kindPillKind(k: ItcExceptionKind): "ok" | "warn" | "amber" | "neutral" {
  switch (k) {
    case "missing-in-2b": return "warn";
    case "gstin-mismatch": return "warn";
    case "value-diff": case "tax-diff": return "amber";
    case "date-diff": case "invoice-no-diff": return "neutral";
    case "missing-in-books": return "amber";
  }
}

function salesKindPillKind(k: SalesException["kind"]): "ok" | "warn" | "amber" | "neutral" {
  switch (k) {
    case "missing-in-gstr1": case "gstin-mismatch": return "warn";
    case "value-diff": case "tax-diff": case "missing-in-books": return "amber";
    default: return "neutral";
  }
}

function KpiTile({ heading, value, sub, tone }: { heading: string; value: string; sub: string; tone: "ok" | "warn" | "neutral" }) {
  const color = tone === "warn" ? "var(--warn-fg)" : tone === "ok" ? "var(--success-fg)" : "var(--ink-200)";
  return (
    <div style={{ textAlign: "center", padding: "8px 6px" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "var(--ink-400)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>{heading}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color, letterSpacing: "-0.015em" }}>{value}</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-300)", marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 14px", letterSpacing: "-0.01em", color: "var(--ink-200)" }}>{children}</h2>;
}

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
