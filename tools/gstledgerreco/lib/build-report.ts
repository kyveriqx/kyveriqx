/* Build the styled Excel GST-reconciliation report.

   Same visual language as the Bank / Org Ledger reports
   (tools/bankledgerreco/lib/build-report.ts): navy/blue headers, INR
   formatting, frozen panes, coloured tabs. Built on demand from a finished
   job's GstReconcileResult — the report IS the reconciliation, not an echo of
   the uploaded files.

   Note: the result is read back from the Supabase `jobs.result` JSON column,
   so every `invoiceDate` arrives as an ISO string, not a Date — `ymd` coerces
   both. Amounts are plain numbers and survive the JSON round-trip.

   Sheets:
     1. Summary             — ITC (and Sales) KPIs, exception breakdown.
     2. ITC Matched         — books ↔ 2B invoices that tied out.
     3. ITC Exceptions      — every flagged invoice, severity-sorted.
     4. Sales Matched       — books ↔ GSTR-1 (only when sales data present).
     5. Sales Exceptions    — short-filed / mismatched sales (conditional).
     6. Supplier filing     — per-GSTIN rollup, sorted by tax at risk.
     7. Notes & Method      — files, column mappings, how it was done. */

import ExcelJS from "exceljs";
import type {
  GstReconcileResult, ItcException, ItcExceptionKind, ItcMatch,
  SalesException, SalesMatch, SupplierRollup,
} from "./types";

// ── palette (matches tools/bankledgerreco/lib/build-report.ts) ──────────────
const C = {
  navy: "FF1F3864",
  blue: "FF2E75B6",
  green: "FF375623",
  ltgrn: "FFE2EFDA",
  red: "FFC00000",
  ltred: "FFFCE4D6",
  amber: "FF7F6000",
  ltamb: "FFFFF2CC",
  gray: "FFF2F2F2",
  dgray: "FFD9D9D9",
  white: "FFFFFFFF",
  black: "FF000000",
} as const;

const INR = '₹#,##0.00;[Red](₹#,##0.00)';

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

/** Row band by ITC exception severity — louder colour for the worse news. */
function itcBand(k: ItcExceptionKind): string | null {
  switch (k) {
    case "missing-in-2b": case "gstin-mismatch": return C.ltred;
    case "value-diff": case "tax-diff": case "missing-in-books": return C.ltamb;
    default: return null;
  }
}
function salesBand(k: SalesException["kind"]): string | null {
  switch (k) {
    case "missing-in-gstr1": case "gstin-mismatch": return C.ltred;
    case "value-diff": case "tax-diff": case "missing-in-books": return C.ltamb;
    default: return null;
  }
}

// ── style helpers ───────────────────────────────────────────────────────────
type Cell = ExcelJS.Cell;
type FillSpec = string | null;
type FontOpts = { color?: string; bold?: boolean; size?: number; italic?: boolean };
type AlignOpts = { h?: "left" | "center" | "right"; v?: "top" | "middle" | "bottom"; wrap?: boolean };

function fill(c: Cell, hex: FillSpec) {
  if (!hex) return;
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hex } };
}
function font(c: Cell, opts: FontOpts = {}) {
  c.font = {
    name: "Calibri",
    color: { argb: opts.color ?? C.black },
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    size: opts.size ?? 10,
  };
}
function align(c: Cell, opts: AlignOpts = {}) {
  c.alignment = { horizontal: opts.h ?? "left", vertical: opts.v ?? "middle", wrapText: opts.wrap ?? false };
}
function thinBorder(c: Cell) {
  const side = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
  c.border = { top: side, left: side, right: side, bottom: side };
}
function wc(
  ws: ExcelJS.Worksheet, row: number, col: number, value: string | number | null,
  fillHex: FillSpec = null, fontOpts: FontOpts | null = null,
  alignOpts: AlignOpts | null = null, numFmt: string | null = null, border = false,
): Cell {
  const c = ws.getCell(row, col);
  c.value = value;
  if (fillHex) fill(c, fillHex);
  if (fontOpts) font(c, fontOpts);
  if (alignOpts) align(c, alignOpts);
  if (numFmt) c.numFmt = numFmt;
  if (border) thinBorder(c);
  return c;
}
function mergeRange(
  ws: ExcelJS.Worksheet, range: string, value: string,
  fillHex: FillSpec, fontOpts: FontOpts, alignOpts: AlignOpts,
) {
  ws.mergeCells(range);
  const c = ws.getCell(range.split(":")[0]);
  c.value = value;
  if (fillHex) fill(c, fillHex);
  font(c, fontOpts);
  align(c, alignOpts);
}
function hdr(ws: ExcelJS.Worksheet, row: number, values: string[], fillHex: string, size = 9, height = 22) {
  ws.getRow(row).height = height;
  for (let i = 0; i < values.length; i++) {
    wc(ws, row, i + 1, values[i], fillHex, { color: C.white, bold: true, size },
      { h: "center", v: "middle", wrap: true }, null, true);
  }
}
function setWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

/** ISO-string-or-Date → "YYYY-MM-DD" (or "" for null). The result comes back
 *  from a JSON column, so dates are strings at runtime. */
function ymd(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const da = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// ── 1. Summary ──────────────────────────────────────────────────────────────
function buildSummary(wb: ExcelJS.Workbook, res: GstReconcileResult, generatedOn: string) {
  const ws = wb.addWorksheet("1. Summary", { properties: { tabColor: { argb: C.navy } } });
  setWidths(ws, [3, 52, 20, 18]);
  const s = res.summary;
  const hasSales = s.salesInvoiceCount + s.gstr1InvoiceCount > 0;

  mergeRange(ws, "B2:D2", "GST LEDGER RECONCILIATION",
    null, { color: C.navy, bold: true, size: 16 }, { h: "left" });
  mergeRange(ws, "B3:D3",
    `ITC (Purchase ↔ GSTR-2B)${hasSales ? " and Sales (Register ↔ GSTR-1)" : ""}  ·  generated ${generatedOn}  ·  amounts in ₹`,
    null, { color: "FF555555", italic: true, size: 9 }, { h: "left" });

  let r = 5;
  const section = (title: string) => {
    mergeRange(ws, `B${r}:D${r}`, title, C.blue, { color: C.white, bold: true, size: 10 }, { h: "left" });
    r++;
  };
  const line = (label: string, value: number, opts: { strong?: boolean; band?: string } = {}) => {
    const f = opts.band ?? null;
    wc(ws, r, 2, label, f, { bold: opts.strong, size: 10 }, { h: "left" }, null, true);
    wc(ws, r, 3, r2(value), f, { bold: opts.strong, size: 10 }, { h: "right" }, INR, true);
    wc(ws, r, 4, "", f, null, null, null, true);
    r++;
  };
  const stat = (label: string, value: string | number, band?: string) => {
    wc(ws, r, 2, label, band ?? null, { size: 10 }, { h: "left" }, null, true);
    wc(ws, r, 3, value, band ?? null, { size: 10 }, { h: "right" }, typeof value === "number" ? "#,##0" : null, true);
    wc(ws, r, 4, "", band ?? null, null, null, null, true);
    r++;
  };

  // ITC headline
  section("INPUT TAX CREDIT  (Purchase Register ↔ GSTR-2B)");
  stat("Invoices in Purchase Register", s.purchaseInvoiceCount);
  stat("Invoices in GSTR-2B", s.twoBInvoiceCount);
  stat("Invoices matched", s.itcMatched, C.ltgrn);
  line("ITC safely matched", s.itcTaxMatched, { strong: true, band: C.ltgrn });
  line("Tax credit at risk", s.itcTaxAtRisk, { strong: true, band: C.ltamb });
  line("Taxable value at risk", s.itcTaxableAtRisk);
  r++;

  // ITC exception breakdown
  section("ITC EXCEPTIONS  (by type)");
  const itcKinds = Object.keys(s.itcExceptionsByKind) as ItcExceptionKind[];
  let anyItc = false;
  for (const k of itcKinds) {
    if (s.itcExceptionsByKind[k] > 0) { stat(`    ${ITC_KIND_LABEL[k]}`, s.itcExceptionsByKind[k], itcBand(k) ?? undefined); anyItc = true; }
  }
  if (!anyItc) stat("    No exceptions — every invoice tied out", 0, C.ltgrn);
  r++;

  // Sales side
  if (hasSales) {
    section("SALES  (Sales Register ↔ GSTR-1)");
    stat("Invoices in Sales Register", s.salesInvoiceCount);
    stat("Invoices in GSTR-1", s.gstr1InvoiceCount);
    stat("Invoices matched", s.salesMatched, C.ltgrn);
    line("Tax at risk", s.salesTaxAtRisk, { strong: true, band: C.ltamb });
    line("Taxable value at risk", s.salesTaxableAtRisk);
    r++;
    section("SALES EXCEPTIONS  (by type)");
    const salesKinds = Object.keys(s.salesExceptionsByKind) as SalesException["kind"][];
    let anySales = false;
    for (const k of salesKinds) {
      if (s.salesExceptionsByKind[k] > 0) { stat(`    ${SALES_KIND_LABEL[k]}`, s.salesExceptionsByKind[k], salesBand(k) ?? undefined); anySales = true; }
    }
    if (!anySales) stat("    No exceptions — every invoice tied out", 0, C.ltgrn);
  }

  ws.views = [{ state: "frozen", ySplit: 4 }];
}

// ── 2. ITC Matched ────────────────────────────────────────────────────────────
function buildItcMatched(wb: ExcelJS.Workbook, res: GstReconcileResult) {
  const ws = wb.addWorksheet("2. ITC Matched", { properties: { tabColor: { argb: C.green } } });
  setWidths(ws, [30, 20, 20, 20, 15, 15, 15, 15, 8, 44]);
  mergeRange(ws, "A1:J1", `ITC MATCHED  (${res.itcMatches.length} invoices)`,
    C.green, { color: C.white, bold: true, size: 12 }, { h: "left" });
  hdr(ws, 2, ["Supplier", "GSTIN", "Invoice No (books)", "Invoice No (2B)",
    "Books Taxable", "2B Taxable", "Books Tax", "2B Tax", "Exact?", "Warnings"], C.navy);

  let r = 3;
  for (const m of res.itcMatches as ItcMatch[]) {
    const band = m.exact ? null : C.ltgrn;
    wc(ws, r, 1, m.twoB.partyName || m.books.partyName || "", band, { size: 9 }, { h: "left", wrap: true }, null, true);
    wc(ws, r, 2, m.books.partyGstin, band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 3, m.books.invoiceNo, band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 4, m.twoB.invoiceNo, band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 5, r2(m.books.taxableValue), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 6, r2(m.twoB.taxableValue), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 7, r2(m.books.totalTax), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 8, r2(m.twoB.totalTax), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 9, m.exact ? "Yes" : "No", band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 10, m.warnings.join(" · "), band, { size: 9 }, { h: "left", wrap: true }, null, true);
    r++;
  }
  wc(ws, r, 4, "Σ matched", null, { bold: true }, { h: "right" }, null, true);
  wc(ws, r, 5, r2(sum(res.itcMatches, (m) => m.books.taxableValue)), null, { bold: true }, { h: "right" }, INR, true);
  wc(ws, r, 6, r2(sum(res.itcMatches, (m) => m.twoB.taxableValue)), null, { bold: true }, { h: "right" }, INR, true);
  wc(ws, r, 7, r2(sum(res.itcMatches, (m) => m.books.totalTax)), null, { bold: true }, { h: "right" }, INR, true);
  wc(ws, r, 8, r2(sum(res.itcMatches, (m) => m.twoB.totalTax)), null, { bold: true }, { h: "right" }, INR, true);
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

// ── 3. ITC Exceptions ──────────────────────────────────────────────────────────
function buildItcExceptions(wb: ExcelJS.Workbook, res: GstReconcileResult) {
  const ws = wb.addWorksheet("3. ITC Exceptions", { properties: { tabColor: { argb: C.red } } });
  setWidths(ws, [18, 30, 20, 18, 12, 12, 14, 14, 14, 14, 14, 44]);
  mergeRange(ws, "A1:L1", `ITC EXCEPTIONS  (${res.itcExceptions.length})`,
    C.red, { color: C.white, bold: true, size: 12 }, { h: "left" });
  hdr(ws, 2, ["Kind", "Supplier", "GSTIN", "Invoice No", "Books Date", "2B Date",
    "Books Taxable", "2B Taxable", "Books Tax", "2B Tax", "Tax at risk", "Note"], C.navy);

  // Already severity-sorted in match.ts — preserve that order.
  let r = 3;
  for (const e of res.itcExceptions as ItcException[]) {
    const ref = e.books ?? e.twoB;
    const band = itcBand(e.kind);
    wc(ws, r, 1, ITC_KIND_LABEL[e.kind], band, { size: 9, bold: true }, { h: "left" }, null, true);
    wc(ws, r, 2, ref?.partyName ?? "", band, { size: 9 }, { h: "left", wrap: true }, null, true);
    wc(ws, r, 3, ref?.partyGstin ?? "", band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 4, ref?.invoiceNo ?? "", band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 5, ymd(e.books?.invoiceDate ?? null), band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 6, ymd(e.twoB?.invoiceDate ?? null), band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 7, e.books ? r2(e.books.taxableValue) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 8, e.twoB ? r2(e.twoB.taxableValue) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 9, e.books ? r2(e.books.totalTax) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 10, e.twoB ? r2(e.twoB.totalTax) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 11, r2(e.taxAtRisk), band, { size: 9, bold: true }, { h: "right" }, INR, true);
    wc(ws, r, 12, e.note, band, { size: 9 }, { h: "left", wrap: true }, null, true);
    r++;
  }
  wc(ws, r, 10, "Σ at risk", null, { bold: true }, { h: "right" }, null, true);
  wc(ws, r, 11, r2(sum(res.itcExceptions, (e) => e.taxAtRisk)), null, { bold: true }, { h: "right" }, INR, true);
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

// ── 4. Sales Matched ──────────────────────────────────────────────────────────
function buildSalesMatched(wb: ExcelJS.Workbook, res: GstReconcileResult) {
  const ws = wb.addWorksheet("4. Sales Matched", { properties: { tabColor: { argb: C.green } } });
  setWidths(ws, [30, 20, 20, 20, 15, 15, 15, 15, 8, 44]);
  mergeRange(ws, "A1:J1", `SALES MATCHED  (${res.salesMatches.length} invoices)`,
    C.green, { color: C.white, bold: true, size: 12 }, { h: "left" });
  hdr(ws, 2, ["Customer", "GSTIN", "Invoice No (books)", "Invoice No (GSTR-1)",
    "Books Taxable", "GSTR-1 Taxable", "Books Tax", "GSTR-1 Tax", "Exact?", "Warnings"], C.navy);

  let r = 3;
  for (const m of res.salesMatches as SalesMatch[]) {
    const band = m.exact ? null : C.ltgrn;
    wc(ws, r, 1, m.gstr1.partyName || m.books.partyName || "", band, { size: 9 }, { h: "left", wrap: true }, null, true);
    wc(ws, r, 2, m.books.partyGstin, band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 3, m.books.invoiceNo, band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 4, m.gstr1.invoiceNo, band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 5, r2(m.books.taxableValue), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 6, r2(m.gstr1.taxableValue), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 7, r2(m.books.totalTax), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 8, r2(m.gstr1.totalTax), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 9, m.exact ? "Yes" : "No", band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 10, m.warnings.join(" · "), band, { size: 9 }, { h: "left", wrap: true }, null, true);
    r++;
  }
  wc(ws, r, 4, "Σ matched", null, { bold: true }, { h: "right" }, null, true);
  wc(ws, r, 5, r2(sum(res.salesMatches, (m) => m.books.taxableValue)), null, { bold: true }, { h: "right" }, INR, true);
  wc(ws, r, 6, r2(sum(res.salesMatches, (m) => m.gstr1.taxableValue)), null, { bold: true }, { h: "right" }, INR, true);
  wc(ws, r, 7, r2(sum(res.salesMatches, (m) => m.books.totalTax)), null, { bold: true }, { h: "right" }, INR, true);
  wc(ws, r, 8, r2(sum(res.salesMatches, (m) => m.gstr1.totalTax)), null, { bold: true }, { h: "right" }, INR, true);
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

// ── 5. Sales Exceptions ────────────────────────────────────────────────────────
function buildSalesExceptions(wb: ExcelJS.Workbook, res: GstReconcileResult) {
  const ws = wb.addWorksheet("5. Sales Exceptions", { properties: { tabColor: { argb: C.red } } });
  setWidths(ws, [18, 30, 20, 18, 12, 12, 14, 14, 14, 14, 14, 44]);
  mergeRange(ws, "A1:L1", `SALES EXCEPTIONS  (${res.salesExceptions.length})`,
    C.red, { color: C.white, bold: true, size: 12 }, { h: "left" });
  hdr(ws, 2, ["Kind", "Customer", "GSTIN", "Invoice No", "Books Date", "GSTR-1 Date",
    "Books Taxable", "GSTR-1 Taxable", "Books Tax", "GSTR-1 Tax", "Tax at risk", "Note"], C.navy);

  // Sales exceptions aren't pre-sorted in match.ts — order by tax at risk desc.
  const rows = [...res.salesExceptions].sort((a, b) => b.taxAtRisk - a.taxAtRisk);
  let r = 3;
  for (const e of rows as SalesException[]) {
    const ref = e.books ?? e.gstr1;
    const band = salesBand(e.kind);
    wc(ws, r, 1, SALES_KIND_LABEL[e.kind], band, { size: 9, bold: true }, { h: "left" }, null, true);
    wc(ws, r, 2, ref?.partyName ?? "", band, { size: 9 }, { h: "left", wrap: true }, null, true);
    wc(ws, r, 3, ref?.partyGstin ?? "", band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 4, ref?.invoiceNo ?? "", band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 5, ymd(e.books?.invoiceDate ?? null), band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 6, ymd(e.gstr1?.invoiceDate ?? null), band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 7, e.books ? r2(e.books.taxableValue) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 8, e.gstr1 ? r2(e.gstr1.taxableValue) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 9, e.books ? r2(e.books.totalTax) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 10, e.gstr1 ? r2(e.gstr1.totalTax) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 11, r2(e.taxAtRisk), band, { size: 9, bold: true }, { h: "right" }, INR, true);
    wc(ws, r, 12, e.note, band, { size: 9 }, { h: "left", wrap: true }, null, true);
    r++;
  }
  wc(ws, r, 10, "Σ at risk", null, { bold: true }, { h: "right" }, null, true);
  wc(ws, r, 11, r2(sum(res.salesExceptions, (e) => e.taxAtRisk)), null, { bold: true }, { h: "right" }, INR, true);
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

// ── 6. Supplier filing status ──────────────────────────────────────────────────
function buildSupplierRollup(wb: ExcelJS.Workbook, res: GstReconcileResult) {
  const ws = wb.addWorksheet("6. Supplier filing", { properties: { tabColor: { argb: C.blue } } });
  setWidths(ws, [20, 32, 13, 16, 16, 12, 16, 16, 14, 16, 16]);
  mergeRange(ws, "A1:K1", `SUPPLIER FILING STATUS  (${res.supplierRollup.length} suppliers, by tax at risk)`,
    C.blue, { color: C.white, bold: true, size: 12 }, { h: "left" });
  hdr(ws, 2, ["GSTIN", "Supplier", "Books inv", "Books Taxable", "Books Tax",
    "2B inv", "2B Taxable", "2B Tax", "Filed late (inv)", "Filed late tax", "Tax at risk"], C.navy);

  // Already sorted by tax at risk desc in match.ts.
  let r = 3;
  for (const sp of res.supplierRollup as SupplierRollup[]) {
    const band = sp.taxAtRisk > 0 ? C.ltamb : null;
    wc(ws, r, 1, sp.gstin, band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 2, sp.name, band, { size: 9 }, { h: "left", wrap: true }, null, true);
    wc(ws, r, 3, sp.booksInvoiceCount, band, { size: 9 }, { h: "center" }, "#,##0", true);
    wc(ws, r, 4, r2(sp.booksTaxableValue), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 5, r2(sp.booksTaxAmount), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 6, sp.twoBInvoiceCount, band, { size: 9 }, { h: "center" }, "#,##0", true);
    wc(ws, r, 7, r2(sp.twoBTaxableValue), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 8, r2(sp.twoBTaxAmount), band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 9, sp.filedLateInvoiceCount || "", band, { size: 9 }, { h: "center" }, "#,##0", true);
    wc(ws, r, 10, sp.filedLateInvoiceCount ? r2(sp.filedLateTaxAmount) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 11, r2(sp.taxAtRisk), band, { size: 9, bold: sp.taxAtRisk > 0 }, { h: "right" }, INR, true);
    r++;
  }
  wc(ws, r, 2, "Σ", null, { bold: true }, { h: "right" }, null, true);
  wc(ws, r, 5, r2(sum(res.supplierRollup, (s) => s.booksTaxAmount)), null, { bold: true }, { h: "right" }, INR, true);
  wc(ws, r, 8, r2(sum(res.supplierRollup, (s) => s.twoBTaxAmount)), null, { bold: true }, { h: "right" }, INR, true);
  wc(ws, r, 11, r2(sum(res.supplierRollup, (s) => s.taxAtRisk)), null, { bold: true }, { h: "right" }, INR, true);
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

// ── 7. Notes & Method ─────────────────────────────────────────────────────────
function buildNotes(wb: ExcelJS.Workbook, res: GstReconcileResult) {
  const ws = wb.addWorksheet("7. Notes & Method", { properties: { tabColor: { argb: C.dgray } } });
  setWidths(ws, [4, 96]);
  mergeRange(ws, "B2:B2", "NOTES & METHODOLOGY", null, { color: C.navy, bold: true, size: 14 }, { h: "left" });
  let r = 4;
  const note = (t: string) => { wc(ws, r, 2, t, null, { size: 10 }, { h: "left", wrap: true }); r++; };
  const heading = (t: string) => { mergeRange(ws, `B${r}:B${r}`, t, C.blue, { color: C.white, bold: true }, { h: "left" }); r++; };

  heading("Files reconciled");
  const srcLabels: [keyof GstReconcileResult["sources"], string][] = [
    ["gstr2b", "GSTR-2B"], ["purchase", "Purchase Register"],
    ["gstr1", "GSTR-1"], ["sales", "Sales Register"], ["gstr2a", "GSTR-2A"],
  ];
  let anyFile = false;
  for (const [key, label] of srcLabels) {
    for (const f of res.sources?.[key] ?? []) { note(`${label}: ${f.file}  (${f.rows} invoices)`); anyFile = true; }
  }
  if (!anyFile) note("(file legend unavailable)");
  r++;

  heading("Detected register columns");
  const cols = (which: string, m: Record<string, string | null>) => {
    const mapped = Object.entries(m).filter(([, v]) => v).map(([k, v]) => `${k} → "${v}"`);
    if (mapped.length) note(`${which}: ${mapped.join("  ·  ")}`);
  };
  cols("Purchase", res.purchaseColumns ?? {});
  cols("Sales", res.salesColumns ?? {});
  r++;

  heading("Method");
  [
    "Both sides are reduced to invoice-level rows and matched on (supplier GSTIN + normalised invoice number). Line-level ERP exports (one row per HSN/item) are first aggregated to invoice level so a multi-line invoice matches its single GSTR-2B row.",
    "Invoice-number normalisation upper-cases, drops punctuation, and strips leading zeros inside numeric runs, so \"GLT/0826/25-26\" and \"GLT/826/25-26\" are treated as the same invoice. The raw number is preserved and an \"invoice no diff\" note is shown when the original strings differ.",
    `Amounts tie within ₹${r2(res.options.amountTolerancePaise / 100)} and dates within ${res.options.dateWindowDays} day(s); beyond that the invoice is flagged value-diff / tax-diff / date-diff. Each portal row is consumed at most once, so leftover 2B/GSTR-1 rows surface as "missing in books".`,
    "Exceptions are sorted worst-first: missing-in-2B and GSTIN mismatches (full ITC at risk) above value/tax/date diffs. The supplier-filing tab uses 2A − 2B to flag invoices the supplier filed past the 2B cutoff.",
  ].forEach(note);

  if (res.notes?.length) {
    r++;
    heading("Run notes");
    for (const n of res.notes) note(n);
  }
}

// ── main export ───────────────────────────────────────────────────────────────
export async function buildGstReport(res: GstReconcileResult, generatedOn?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kyveriqx — GST Ledger Reconciliation";
  wb.created = new Date();
  const on = generatedOn ?? new Date().toISOString().slice(0, 10);

  buildSummary(wb, res, on);
  buildItcMatched(wb, res);
  buildItcExceptions(wb, res);
  if (res.summary.salesInvoiceCount + res.summary.gstr1InvoiceCount > 0) {
    buildSalesMatched(wb, res);
    buildSalesExceptions(wb, res);
  }
  buildSupplierRollup(wb, res);
  buildNotes(wb, res);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
