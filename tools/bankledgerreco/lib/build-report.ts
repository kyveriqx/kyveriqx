/* Build the styled Excel bank-reconciliation report.

   Same visual language as the Org Ledger report (core/lib/ledger/build-report.ts):
   navy/blue headers, INR formatting, frozen panes, coloured tabs. Built on
   demand from a finished job's BankReconcileResult (no raw rows are stored, so
   the full input ledgers are not reproduced — the report is the reconciliation,
   not an echo of the uploads).

   Sheets:
     1. Summary        — headline net movements, the reconciliation bridge that
                         ties the gap to the rupee, and match statistics.
     2. Matched        — every matched group (1:1, grouped, contra, settlement).
     3. Exceptions — Bank   — unmatched bank lines, grouped by reason.
     4. Exceptions — Books  — unmatched book lines, grouped by reason.
     5. Action Plan    — what to do with the exceptions.
     6. Notes & Method — how the reconciliation was done. */

import ExcelJS from "exceljs";
import type {
  BankReconcileResult, MatchGroup, MatchMethod, UnmatchedSide,
} from "./types";

// ── palette (matches core/lib/ledger/build-report.ts) ───────────────────────
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

const METHOD_LABEL: Record<MatchMethod, string> = {
  exact: "Exact (same date)",
  "date-tolerant": "Date-tolerant",
  "group-exact": "Grouped (UPI / instalment)",
  "group-fee": "Gateway settlement (fee inferred)",
  settlement: "Razorpay settlement",
  reversal: "Reversal / refund",
  contra: "Contra (nets to zero)",
  rounding: "Matched – round-off",
};

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

// ── 1. Summary ──────────────────────────────────────────────────────────────
function buildSummary(wb: ExcelJS.Workbook, res: BankReconcileResult, generatedOn: string) {
  const ws = wb.addWorksheet("1. Summary", { properties: { tabColor: { argb: C.navy } } });
  setWidths(ws, [3, 52, 20, 18]);
  const s = res.summary;

  mergeRange(ws, "B2:D2", "BANK RECONCILIATION STATEMENT",
    null, { color: C.navy, bold: true, size: 16 }, { h: "left" });
  mergeRange(ws, "B3:D3",
    `Bank statement vs Books ledger  ·  generated ${generatedOn}  ·  amounts in ₹  ·  inflow positive`,
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

  // Headline — net movement both sides
  section("HEADLINE (net movement for the period)");
  line("Bank statement — net inflow (credits − debits)", s.bankNet);
  line("Books ledger — net inflow (debits − credits)", s.booksNet);
  line("DIFFERENCE  (Bank − Books)", s.netGap, { strong: true, band: C.ltamb });
  r++;

  // Bridge — reconciling items that tie the difference to the rupee
  const ub = res.unmatchedBank, kb = res.unmatchedBooks;
  const bankDep = r2(sum(ub.filter((u) => u.signed > 0), (u) => u.signed));
  const bankChg = r2(sum(ub.filter((u) => u.signed < 0), (u) => u.signed));
  const bookRcpt = r2(sum(kb.filter((u) => u.signed > 0), (u) => u.signed));
  const bookPay = r2(sum(kb.filter((u) => u.signed < 0), (u) => u.signed));
  const fees = r2(s.feesIdentified);
  const bridge = r2(bankDep + bankChg - bookRcpt - bookPay - fees);

  section("HOW THE DIFFERENCE ARISES  (reconciliation bridge)");
  line("Add:  Deposits on bank, not yet in books", bankDep);
  line("Less: Charges / withdrawals on bank, not in books", bankChg);
  line("Less: Receipts in books, not yet on bank (in transit)", -bookRcpt);
  line("Add:  Payments in books, not yet on bank (in transit)", -bookPay);
  if (Math.abs(fees) >= 0.005) line("Less: Gateway / UPI fees identified on matches", -fees);
  line("= DIFFERENCE  (Bank − Books)", bridge, { strong: true, band: C.ltamb });
  if (Math.abs(bridge - s.netGap) >= 0.5) {
    mergeRange(ws, `B${r}:D${r}`,
      `Note: bridge ${r2(bridge)} vs headline gap ${r2(s.netGap)} — rounding.`,
      null, { italic: true, size: 9, color: "FF555555" }, { h: "left" });
    r++;
  }
  r++;

  // Match statistics
  section("RECONCILIATION STATISTICS");
  const stat = (label: string, value: string | number, band?: string) => {
    wc(ws, r, 2, label, band ?? null, { size: 10 }, { h: "left" }, null, true);
    wc(ws, r, 3, value, band ?? null, { size: 10 }, { h: "right" }, typeof value === "number" ? "#,##0" : null, true);
    wc(ws, r, 4, "", band ?? null, null, null, null, true);
    r++;
  };
  stat("Bank statement lines", s.bankTotalRows);
  stat("Books ledger entries", s.booksTotalRows);
  stat("Matched groups", s.matchedGroups);
  for (const m of Object.keys(s.byMethod) as MatchMethod[]) {
    if (s.byMethod[m] > 0) stat(`    ${METHOD_LABEL[m]}`, s.byMethod[m]);
  }
  stat("Unmatched — Bank (exceptions)", s.unmatchedBankCount, C.ltred);
  stat("Unmatched — Books (exceptions)", s.unmatchedBooksCount, C.ltred);
  if (Math.abs(s.bankChargesTotal) >= 0.005) line("    of which bank charges (flagged)", -Math.abs(s.bankChargesTotal));
  if (Math.abs(s.interestTotal) >= 0.005) line("    of which interest (flagged)", Math.abs(s.interestTotal));
  if (Math.abs(s.tdsTotal) >= 0.005) line("    of which TDS (flagged)", -Math.abs(s.tdsTotal));

  ws.views = [{ state: "frozen", ySplit: 4 }];
}

// ── 2. Matched ──────────────────────────────────────────────────────────────
function fmt(d: string | null): string { return d ?? ""; }

function buildMatched(wb: ExcelJS.Workbook, res: BankReconcileResult) {
  const ws = wb.addWorksheet("2. Matched", { properties: { tabColor: { argb: C.green } } });
  setWidths(ws, [26, 13, 14, 34, 13, 14, 34, 13, 8, 7, 34]);
  mergeRange(ws, "A1:K1", `MATCHED  (${res.groups.length} groups)`,
    C.green, { color: C.white, bold: true, size: 12 }, { h: "left" });
  hdr(ws, 2, ["Method", "Bank Date", "Bank Amount", "Bank Description",
    "Books Date", "Books Amount", "Books Description", "Fee / diff", "Conf.", "Days", "Note"], C.navy);

  const groups = [...res.groups].sort((a, b) => (a.bankDate ?? a.booksDate ?? "").localeCompare(b.bankDate ?? b.booksDate ?? ""));
  let r = 3;
  for (const g of groups) {
    const band = g.method === "contra" ? C.gray : g.method === "reversal" ? C.ltamb
      : g.method === "rounding" ? C.ltgrn : null;
    wc(ws, r, 1, METHOD_LABEL[g.method], band, { size: 9 }, { h: "left" }, null, true);
    wc(ws, r, 2, fmt(g.bankDate), band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 3, g.bankAmount, band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 4, g.bankDesc, band, { size: 9 }, { h: "left", wrap: true }, null, true);
    wc(ws, r, 5, fmt(g.booksDate), band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 6, g.booksAmount, band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 7, g.booksDesc, band, { size: 9 }, { h: "left", wrap: true }, null, true);
    wc(ws, r, 8, g.fee ? r2(g.fee) : "", band, { size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 9, g.confidence, band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 10, g.dateGapDays, band, { size: 9 }, { h: "center" }, null, true);
    wc(ws, r, 11, [METHOD_LABEL[g.method] === g.note ? "" : g.note ?? "",
      `${g.bankRows.length}↔${g.booksRows.length} rows`].filter(Boolean).join(" · "),
      band, { size: 9 }, { h: "left" }, null, true);
    r++;
  }
  wc(ws, r, 2, "Σ matched", null, { bold: true }, { h: "right" }, null, true);
  wc(ws, r, 3, r2(sum(groups, (g) => g.bankAmount)), null, { bold: true }, { h: "right" }, INR, true);
  wc(ws, r, 6, r2(sum(groups, (g) => g.booksAmount)), null, { bold: true }, { h: "right" }, INR, true);
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

// ── 3 / 4. Exceptions ────────────────────────────────────────────────────────
const BANK_REASON: Record<string, string> = {
  "bank-charge": "Bank charge — not booked",
  interest: "Interest credited — not booked",
  tds: "TDS deducted — not booked",
  "possible-reversal": "Possible reversal",
};
function bankReason(u: UnmatchedSide): string {
  if (u.hint && BANK_REASON[u.hint]) return BANK_REASON[u.hint];
  return u.signed > 0 ? "Deposit on bank — not booked (UPI / receipt timing)" : "Withdrawal on bank — not booked";
}
function booksReason(u: UnmatchedSide): string {
  if (u.hint === "possible-reversal") return "Possible reversal / contra";
  return u.signed > 0 ? "Receipt in books — not yet on bank (in transit)" : "Payment in books — not yet on bank (in transit)";
}

function buildExceptions(
  wb: ExcelJS.Workbook, title: string, tab: string,
  rows: UnmatchedSide[], reasonOf: (u: UnmatchedSide) => string,
) {
  const ws = wb.addWorksheet(tab, { properties: { tabColor: { argb: C.red } } });
  setWidths(ws, [13, 26, 9, 46, 15, 15, 34]);
  mergeRange(ws, "A1:G1", title, C.red, { color: C.white, bold: true, size: 12 }, { h: "left" });
  hdr(ws, 2, ["Date", "File", "Row", "Description", "Debit", "Credit", "Reason"], C.navy);

  const groups = new Map<string, UnmatchedSide[]>();
  for (const u of rows) {
    const k = reasonOf(u);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(u);
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    Math.abs(sum(b[1], (u) => u.signed)) - Math.abs(sum(a[1], (u) => u.signed)));

  let r = 3;
  let grand = 0;
  for (const [reason, items] of ordered) {
    mergeRange(ws, `A${r}:G${r}`, `${reason}  (${items.length})`,
      C.gray, { bold: true, size: 9 }, { h: "left" });
    r++;
    items.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    for (const u of items) {
      wc(ws, r, 1, u.date ?? "", null, { size: 9 }, { h: "center" }, null, true);
      wc(ws, r, 2, u.file ?? "", null, { size: 9 }, { h: "left" }, null, true);
      wc(ws, r, 3, u.fileRow ?? u.row, null, { size: 9 }, { h: "center" }, null, true);
      wc(ws, r, 4, u.description, null, { size: 9 }, { h: "left" }, null, true);
      wc(ws, r, 5, u.debit || "", null, { size: 9 }, { h: "right" }, INR, true);
      wc(ws, r, 6, u.credit || "", null, { size: 9 }, { h: "right" }, INR, true);
      wc(ws, r, 7, reason, null, { size: 9 }, { h: "left" }, null, true);
      r++;
    }
    const sub = r2(sum(items, (u) => u.signed));
    grand += sub;
    wc(ws, r, 4, `Subtotal — ${reason}`, C.ltamb, { bold: true, size: 9 }, { h: "right" }, null, true);
    wc(ws, r, 5, "", C.ltamb, null, null, null, true);
    wc(ws, r, 6, sub, C.ltamb, { bold: true, size: 9 }, { h: "right" }, INR, true);
    wc(ws, r, 7, "", C.ltamb, null, null, null, true);
    r++;
  }
  wc(ws, r, 4, "TOTAL (net)", null, { bold: true }, { h: "right" }, null, true);
  wc(ws, r, 6, r2(grand), null, { bold: true }, { h: "right" }, INR, true);
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

// ── 5. Action Plan ────────────────────────────────────────────────────────────
function buildActionPlan(wb: ExcelJS.Workbook, res: BankReconcileResult) {
  const ws = wb.addWorksheet("5. Action Plan", { properties: { tabColor: { argb: "FFED7D31" } } });
  setWidths(ws, [4, 70, 16]);
  const s = res.summary;
  mergeRange(ws, "B2:C2", "ACTION PLAN", null, { color: C.navy, bold: true, size: 14 }, { h: "left" });
  let r = 4;
  hdr(ws, r, ["", "Step", "Items / ₹"], C.navy); r++;
  const step = (text: string, metric: string | number) => {
    wc(ws, r, 1, "", null, null, null, null, true);
    wc(ws, r, 2, text, null, { size: 10 }, { h: "left", wrap: true }, null, true);
    wc(ws, r, 3, metric, null, { size: 10 }, { h: "right" }, typeof metric === "number" ? INR : null, true);
    ws.getRow(r).height = 28;
    r++;
  };
  step("Book the bank charges / GST the bank has already debited (see Exceptions — Bank).",
    r2(Math.abs(s.bankChargesTotal)));
  step("Post the UPI/receipt deposits the bank credited that the books haven't recorded yet.",
    s.unmatchedBankCount);
  step("Chase the in-transit receipts/payments booked but not yet on the statement (clear next period).",
    s.unmatchedBooksCount);
  if (s.interestTotal) step("Record interest credited by the bank.", r2(s.interestTotal));
  if (s.tdsTotal) step("Record TDS deducted by the bank.", r2(s.tdsTotal));
  step("After posting the above, the residual difference should reduce towards zero.", r2(s.netGap));
}

// ── 6. Notes & Method ─────────────────────────────────────────────────────────
function buildNotes(wb: ExcelJS.Workbook, res: BankReconcileResult) {
  const ws = wb.addWorksheet("6. Notes & Method", { properties: { tabColor: { argb: C.dgray } } });
  setWidths(ws, [4, 96]);
  mergeRange(ws, "B2:B2", "NOTES & METHODOLOGY", null, { color: C.navy, bold: true, size: 14 }, { h: "left" });
  let r = 4;
  const note = (t: string) => { wc(ws, r, 2, t, null, { size: 10 }, { h: "left", wrap: true }); r++; };

  mergeRange(ws, `B${r}:B${r}`, "Files reconciled", C.blue, { color: C.white, bold: true }, { h: "left" }); r++;
  for (const f of res.sources?.bank ?? []) note(`Bank: ${f.file}  (${f.rows} rows)`);
  for (const f of res.sources?.books ?? []) note(`Books: ${f.file}  (${f.rows} rows)`);
  for (const f of res.sources?.settlement ?? []) note(`Settlement: ${f.file}  (${f.rows} rows)`);
  r++;
  mergeRange(ws, `B${r}:B${r}`, "Method", C.blue, { color: C.white, bold: true }, { h: "left" }); r++;
  [
    "Both sides are normalised to a signed amount (positive = inflow): bank = credit − debit, books = debit − credit, so equal signed amounts are the same money moving the same way.",
    "Matching runs in tiers, highest confidence first: exact (same date) → date-tolerant → grouped (one bank line = many book rows, e.g. UPI day-settlement) → gateway fee → reversals → contra. Each row is used once.",
    "Contra: equal-and-opposite book entries that net to zero with no bank line (own-account transfers, FD placement & redemption, provision & reversal) are paired so they leave the exception list.",
    "The headline difference is computed from column totals, independent of matching. Exceptions are not errors — they are timing or not-yet-booked items, listed by reason on the Exceptions sheets.",
  ].forEach(note);
  if (res.notes?.length) {
    r++;
    mergeRange(ws, `B${r}:B${r}`, "Run notes", C.blue, { color: C.white, bold: true }, { h: "left" }); r++;
    for (const n of res.notes) note(n);
  }
}

// ── main export ───────────────────────────────────────────────────────────────
export async function buildBankReport(res: BankReconcileResult, generatedOn?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kyveriqx — Bank Ledger Reconciliation";
  wb.created = new Date();
  const on = generatedOn ?? new Date().toISOString().slice(0, 10);

  buildSummary(wb, res, on);
  buildMatched(wb, res);
  buildExceptions(wb, "EXCEPTIONS — on Bank Statement, not in Books", "3. Exceptions — Bank", res.unmatchedBank, bankReason);
  buildExceptions(wb, "EXCEPTIONS — in Books, not on Bank Statement", "4. Exceptions — Books", res.unmatchedBooks, booksReason);
  buildActionPlan(wb, res);
  buildNotes(wb, res);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
