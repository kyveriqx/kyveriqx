/* Build the styled 4-sheet Excel reconciliation report.

   Direct port of export_report.py using exceljs (in place of openpyxl).
   Sheets: 1.Summary, 2.Matched Invoices, 3.Gaps & Unmatched, 4.Action Plan.
   Preserves colours, merges, fonts, INR formatting, frozen panes. */

import ExcelJS from "exceljs";
import type {
  LocationSummary,
  MatchedInvoice,
  ReconcileResult,
  UnmatchedCompanyInvoice,
  UnmatchedCompanyPayment,
  UnmatchedPartnerInvoice,
} from "./types";

// ── palette (matches Python's C dict) ───────────────────────────────────────
const C = {
  navy:  "FF1F3864",
  blue:  "FF2E75B6",
  green: "FF375623",
  ltgrn: "FFE2EFDA",
  red:   "FFC00000",
  ltred: "FFFCE4D6",
  amber: "FF7F6000",
  ltamb: "FFFFF2CC",
  gray:  "FFF2F2F2",
  dgray: "FFD9D9D9",
  white: "FFFFFFFF",
  black: "FF000000",
} as const;

const INR = "₹#,##0.00";

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
  c.alignment = {
    horizontal: opts.h ?? "left",
    vertical: opts.v ?? "middle",
    wrapText: opts.wrap ?? false,
  };
}

function thinBorder(c: Cell) {
  const side = { style: "thin" as const, color: { argb: "FFBFBFBF" } };
  c.border = { top: side, left: side, right: side, bottom: side };
}

function thickBorder(c: Cell) {
  const side = { style: "medium" as const, color: { argb: "FF7F7F7F" } };
  c.border = { top: side, left: side, right: side, bottom: side };
}

function wc(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: string | number | null,
  fillHex: FillSpec = null,
  fontOpts: FontOpts | null = null,
  alignOpts: AlignOpts | null = null,
  numFmt: string | null = null,
  border: "thin" | "thick" | null = null,
): Cell {
  const c = ws.getCell(row, col);
  c.value = value;
  if (fillHex) fill(c, fillHex);
  if (fontOpts) font(c, fontOpts);
  if (alignOpts) align(c, alignOpts);
  if (numFmt) c.numFmt = numFmt;
  if (border === "thin") thinBorder(c);
  else if (border === "thick") thickBorder(c);
  return c;
}

function mergeRange(
  ws: ExcelJS.Worksheet,
  range: string,
  value: string,
  fillHex: FillSpec,
  fontOpts: FontOpts,
  alignOpts: AlignOpts,
  border: "thin" | "thick" | null = null,
) {
  ws.mergeCells(range);
  const start = range.split(":")[0];
  const c = ws.getCell(start);
  c.value = value;
  if (fillHex) fill(c, fillHex);
  font(c, fontOpts);
  align(c, alignOpts);
  if (border === "thin") thinBorder(c);
  else if (border === "thick") thickBorder(c);
}

function hdr(
  ws: ExcelJS.Worksheet,
  row: number,
  values: string[],
  fillHex: string,
  size = 9,
  height = 24,
) {
  ws.getRow(row).height = height;
  for (let i = 0; i < values.length; i++) {
    wc(ws, row, i + 1, values[i], fillHex,
      { color: C.white, bold: true, size },
      { h: "center", v: "middle" },
      null, "thin");
  }
}

function setWidths(ws: ExcelJS.Worksheet, mapping: Record<string, number>) {
  for (const [letter, w] of Object.entries(mapping)) {
    ws.getColumn(letter).width = w;
  }
}

function dateStr(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

// ── sheet builders ──────────────────────────────────────────────────────────

function buildSummary(wb: ExcelJS.Workbook, res: ReconcileResult) {
  const ws = wb.addWorksheet("1. Summary", {
    properties: { tabColor: { argb: C.red } },
    views: [{ showGridLines: false }],
  });
  setWidths(ws, { A: 3, B: 24, C: 20, D: 4, E: 20, F: 24, G: 3 });

  // Title
  ws.getRow(1).height = 48;
  mergeRange(ws, "B1:F1",
    "LEDGER RECONCILIATION REPORT\nYour Company  ·  Business Partner",
    C.navy,
    { color: C.white, bold: true, size: 15 },
    { h: "center", v: "middle", wrap: true },
    "thick");

  ws.getRow(2).height = 8;

  // Balance comparison
  let r = 3;
  ws.getRow(r).height = 18;
  mergeRange(ws, `B${r}:C${r}`, "YOUR BOOKS SAY", C.blue,
    { color: C.white, bold: true, size: 11 }, { h: "center" });
  mergeRange(ws, `E${r}:F${r}`, "BUSINESS PARTNER'S BOOKS SAY", C.blue,
    { color: C.white, bold: true, size: 11 }, { h: "center" });

  r = 4;
  ws.getRow(r).height = 44;
  const companyLbl = `₹${Math.abs(res.companyClosing).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n${res.companySignLabel}`;
  const partnerLbl = `₹${Math.abs(res.partnerClosing).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n${res.partnerSignLabel}`;
  mergeRange(ws, `B${r}:C${r}`, companyLbl, C.ltred,
    { color: C.red, bold: true, size: 13 },
    { h: "center", v: "middle", wrap: true });
  mergeRange(ws, `D${r}:D${r + 1}`, "vs", C.dgray,
    { color: "FF7F7F7F", bold: true, size: 12 }, { h: "center" });
  mergeRange(ws, `E${r}:F${r}`, partnerLbl, C.ltred,
    { color: C.red, bold: true, size: 13 },
    { h: "center", v: "middle", wrap: true });

  r = 5; ws.getRow(r).height = 8;

  r = 6; ws.getRow(r).height = 32;
  mergeRange(ws, `B${r}:F${r}`,
    `⚠   TOTAL GAP = ₹${res.totalGap.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}  |  Both books disagree by this amount`,
    "FFFF0000",
    { color: C.white, bold: true, size: 14 },
    { h: "center", v: "middle" });

  ws.getRow(7).height = 10;

  // Location status
  r = 8; ws.getRow(r).height = 20;
  mergeRange(ws, `B${r}:F${r}`, "BUSINESS PARTNER LOCATION STATUS",
    C.navy, { color: C.white, bold: true, size: 11 }, { h: "center" });

  r = 9;
  hdr(ws, r, ["Location", "Opening Balance", "Closing Balance",
    "Matched Invoices", "Status"], C.blue);

  for (const loc of res.locationSummary) {
    r += 1;
    ws.getRow(r).height = 18;
    const ok = loc.status === "Settled";
    const fx = ok ? C.ltgrn : C.ltred;
    const fc = ok ? C.green : C.red;
    const vals: (string | number)[] = [
      loc.location,
      `₹${Math.abs(loc.openingBal).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `₹${Math.abs(loc.closingBal).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      loc.matchedInv,
      ok ? "✓ FULLY SETTLED" : "✗ OUTSTANDING",
    ];
    for (let i = 0; i < vals.length; i++) {
      wc(ws, r, i + 1, vals[i], fx,
        { color: fc, bold: !ok, size: 9 },
        { h: "center" }, null, "thin");
    }
  }

  ws.getRow(r + 1).height = 10;
  r += 2;

  mergeRange(ws, `B${r}:F${r}`, "GAP BREAKDOWN", C.navy,
    { color: C.white, bold: true, size: 11 }, { h: "center" });
  r += 1;
  hdr(ws, r, ["#", "Gap Type", "In Your Books?", "In Partner's Books?", "Amount (₹)"], C.blue);

  const sumPayments = res.unmatchedCompanyPay.reduce((s, p) => s + p.amount, 0);
  const sumCompanyInv = res.unmatchedCompanyInv.reduce((s, g) => s + Math.abs(g.credit), 0);
  const sumPartnerInv = res.unmatchedPartnerInv.reduce((s, v) => s + Math.abs(v.amount), 0);

  const gaps: [string, string, string, number][] = [
    ["Unmatched Payments",
      `${res.unmatchedCompanyPay.length} payment(s) in your books`,
      "Not found in Business Partner's",
      sumPayments],
    ["Invoices only in your books",
      `${res.unmatchedCompanyInv.length} invoice(s)`,
      "Not in Business Partner's books",
      sumCompanyInv],
    ["Invoices only in Partner's books",
      "Not in your books",
      `${res.unmatchedPartnerInv.length} invoice(s)`,
      sumPartnerInv],
    ["TDS on matched invoices",
      "Deducted and recorded",
      "To be offset via JV entries",
      res.totalTds],
  ];

  for (let i = 0; i < gaps.length; i++) {
    const [typ, companyTxt, partnerTxt, amt] = gaps[i];
    r += 1; ws.getRow(r).height = 18;
    const fx = amt > 0 ? C.ltred : C.ltgrn;
    const vals: (string | number)[] = [i + 1, typ, companyTxt, partnerTxt, amt];
    for (let j = 0; j < vals.length; j++) {
      const nf = j === 4 ? INR : null;
      wc(ws, r, j + 1, vals[j], fx,
        { size: 9 }, { h: "center" }, nf, "thin");
    }
  }

  r += 2; ws.getRow(r).height = 20;
  mergeRange(ws, `B${r}:D${r}`, "TOTAL COMBINED GAP", C.red,
    { color: C.white, bold: true, size: 10 }, { h: "center" });
  mergeRange(ws, `E${r}:F${r}`,
    `₹${res.totalGap.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    C.red, { color: C.white, bold: true, size: 13 }, { h: "center" });

  // ── Why the books differ (TDS net + cut-off/timing) ─────────────────────
  const ga = res.gapAnalysis;
  if (ga) {
    r += 2; ws.getRow(r).height = 20;
    mergeRange(ws, `B${r}:F${r}`, "WHY THE BOOKS DIFFER", C.navy,
      { color: C.white, bold: true, size: 11 }, { h: "center" });

    const small = Math.abs(ga.tdsNet) < Math.max(5000, res.totalGap * 0.5);
    const lines: [string, string][] = [
      ["TDS",
        `You deducted ₹${money(ga.tdsCompanyDeducted)}; partner credited ₹${money(ga.tdsPartnerCredited)} → net ₹${money(ga.tdsNet)}. ${small ? "Largely nets out — not the main cause." : "Material — chase the missing TDS credit."}`],
      ["Cut-off / timing",
        ga.cutoffItems.length
          ? `${ga.cutoffItems.length} entr${ga.cutoffItems.length > 1 ? "ies" : "y"} totalling ₹${money(ga.cutoffTotal)} fall outside the other book's dates (your last ${fmtDate(ga.companyLastDate)} · partner's last ${fmtDate(ga.partnerLastDate)}).`
          : "None — both books cover the same period."],
      ["Match coverage",
        `${ga.matchedInvoiceCount} invoices matched (${ga.amountDateMatchedCount} by amount+date where invoice numbers differ).`],
    ];
    for (const [label, text] of lines) {
      r += 1; ws.getRow(r).height = 28;
      wc(ws, r, 2, label, C.gray, { bold: true, size: 9 }, { h: "left", v: "middle" }, null, "thin");
      mergeRange(ws, `C${r}:F${r}`, text, C.white, { size: 9 }, { h: "left", v: "middle", wrap: true });
    }

    if (ga.cutoffItems.length) {
      r += 1;
      hdr(ws, r, ["Side", "Location", "Reference", "Date", "Amount (₹)"], C.blue);
      for (const c of ga.cutoffItems.slice(0, 12)) {
        r += 1; ws.getRow(r).height = 16;
        const vals: (string | number)[] = [
          c.side === "company" ? "Your books" : "Partner",
          c.location, c.ref, fmtDate(c.date), c.amount,
        ];
        for (let j = 0; j < vals.length; j++) {
          wc(ws, r, j + 1, vals[j], C.ltamb, { size: 9 }, { h: "center" }, j === 4 ? INR : null, "thin");
        }
      }
    }
  }
}

function money(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

function buildMatched(wb: ExcelJS.Workbook, res: ReconcileResult) {
  const ws = wb.addWorksheet("2. Matched Invoices", {
    properties: { tabColor: { argb: C.green } },
    views: [{ showGridLines: false }],
  });
  setWidths(ws, { A: 4, B: 24, C: 14, D: 16, E: 24, F: 14, G: 16, H: 14, I: 14, J: 12 });

  ws.getRow(1).height = 36;
  mergeRange(ws, "A1:J1",
    `MATCHED INVOICES  —  (${res.matchedInvoices.length} records)`,
    C.green, { color: C.white, bold: true, size: 13 },
    { h: "center", v: "middle" });

  hdr(ws, 2, [
    "Location", "Partner Invoice No.", "Partner Date", "Partner Amt (₹)",
    "Your Ref No.", "Your Date", "Your Amt (₹)", "TDS (₹)", "Diff (₹)", "Status",
  ], C.navy, 9);
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2, showGridLines: false }];

  let r = 2;
  for (let i = 0; i < res.matchedInvoices.length; i++) {
    const m = res.matchedInvoices[i];
    r += 1;
    const altFx = i % 2 === 0 ? C.ltgrn : "FFF0FAF0";
    const stColor =
      m.status === "Matched" ? C.ltgrn :
      m.status.includes("TDS") ? C.ltamb : C.ltred;
    const stFc =
      m.status === "Matched" ? C.green :
      m.status.includes("TDS") ? C.amber : C.red;

    const partnerAmt = Math.abs(m.partnerAmount);
    const diff = m.amountDiff;
    const tds = m.tdsDeducted || 0;

    const vals: (string | number)[] = [
      m.location,
      m.invoiceNo,
      dateStr(m.partnerDate),
      partnerAmt,
      m.companyRef,
      dateStr(m.companyDate),
      m.companyAmount,
      tds ? tds : "",
      diff ? diff : "",
      m.status,
    ];
    const nfs: (string | null)[] = [null, null, null, INR, null, null, INR,
      tds ? INR : null, diff ? INR : null, null];
    const aligns: ("center" | "right")[] = [
      "center", "right", "center", "right", "right", "center", "right",
      "right", "right", "center"];

    for (let j = 0; j < vals.length; j++) {
      const col = j + 1;
      const isStatus = col === 10;
      wc(ws, r, col, vals[j],
        isStatus ? stColor : altFx,
        { color: isStatus ? stFc : C.black, bold: isStatus, size: 9 },
        { h: aligns[j] },
        nfs[j], "thin");
    }
  }
}

function buildGaps(wb: ExcelJS.Workbook, res: ReconcileResult) {
  const ws = wb.addWorksheet("3. Gaps & Unmatched", {
    properties: { tabColor: { argb: C.red } },
    views: [{ showGridLines: false }],
  });
  setWidths(ws, { A: 4, B: 24, C: 14, D: 16, E: 40, F: 20, G: 4 });

  ws.getRow(1).height = 36;
  mergeRange(ws, "A1:F1",
    "GAPS & UNMATCHED ITEMS  —  (Items requiring action)",
    C.red, { color: C.white, bold: true, size: 13 },
    { h: "center", v: "middle" });

  let r = 2;
  const startR = r;

  // ── Unmatched payments
  if (res.unmatchedCompanyPay.length > 0) {
    r += 1; ws.getRow(r).height = 20;
    mergeRange(ws, `A${r}:F${r}`,
      `PAYMENTS IN YOUR BOOKS NOT IN BUSINESS PARTNER'S BOOKS  (${res.unmatchedCompanyPay.length} items)`,
      C.red, { color: C.white, bold: true, size: 10 }, { h: "center" });
    r += 1;
    hdr(ws, r, ["Your Payment Ref", "Date", "Amount (₹)", "Reason", "What To Do", "Status"], C.navy, 9);
    for (const p of res.unmatchedCompanyPay) {
      r += 1; ws.getRow(r).height = 32;
      const vals: (string | number)[] = [
        p.companyRef,
        dateStr(p.date),
        p.amount,
        p.reason ?? "",
        "Send bank transfer proof to Business Partner. Ask them to confirm receipt and post in their books.",
        "⚠ ACTION NEEDED",
      ];
      const aligns: ("left" | "center")[] = ["left", "center", "center", "left", "left", "center"];
      for (let j = 0; j < vals.length; j++) {
        const col = j + 1;
        const isStatus = col === 6;
        wc(ws, r, col, vals[j], C.ltred,
          { color: isStatus ? C.red : C.black, bold: isStatus, size: 9 },
          { h: aligns[j], v: "middle", wrap: true },
          col === 3 ? INR : null, "thin");
      }
    }
  }

  // ── Company invoices not in partner
  if (res.unmatchedCompanyInv.length > 0) {
    r += 2; ws.getRow(r).height = 20;
    mergeRange(ws, `A${r}:F${r}`,
      `INVOICES IN YOUR BOOKS NOT FOUND IN BUSINESS PARTNER'S BOOKS  (${res.unmatchedCompanyInv.length} items)`,
      C.amber, { color: C.white, bold: true, size: 10 }, { h: "center" });
    r += 1;
    hdr(ws, r, ["Your Ref No.", "Date", "Amount (₹)", "Partner Ref", "Reason", "Status"], C.navy, 9);
    for (const g of res.unmatchedCompanyInv) {
      r += 1; ws.getRow(r).height = 24;
      const vals: (string | number)[] = [
        g.docNo,
        dateStr(g.date),
        g.credit,
        g.extNo,
        g.reason,
        "⚠ VERIFY",
      ];
      const aligns: ("left" | "center")[] = ["left", "center", "center", "left", "left", "center"];
      for (let j = 0; j < vals.length; j++) {
        const col = j + 1;
        const isStatus = col === 6;
        wc(ws, r, col, vals[j], C.ltamb,
          { color: isStatus ? C.amber : C.black, bold: isStatus, size: 9 },
          { h: aligns[j] },
          col === 3 ? INR : null, "thin");
      }
    }
  }

  // ── Partner invoices not in company
  if (res.unmatchedPartnerInv.length > 0) {
    r += 2; ws.getRow(r).height = 20;
    mergeRange(ws, `A${r}:F${r}`,
      `INVOICES IN BUSINESS PARTNER'S BOOKS NOT FOUND IN YOUR BOOKS  (${res.unmatchedPartnerInv.length} items)`,
      C.amber, { color: C.white, bold: true, size: 10 }, { h: "center" });
    r += 1;
    hdr(ws, r, ["Partner Invoice No.", "Location", "Date", "Amount (₹)", "Reason", "Status"], C.navy, 9);
    for (const v of res.unmatchedPartnerInv) {
      r += 1; ws.getRow(r).height = 24;
      const vals: (string | number)[] = [
        v.docNo,
        v.location,
        dateStr(v.date),
        Math.abs(v.amount),
        v.reason,
        "⚠ CHECK",
      ];
      const aligns: ("left" | "center")[] = ["left", "center", "center", "center", "left", "center"];
      for (let j = 0; j < vals.length; j++) {
        const col = j + 1;
        const isStatus = col === 6;
        wc(ws, r, col, vals[j], C.ltamb,
          { color: isStatus ? C.amber : C.black, bold: isStatus, size: 9 },
          { h: aligns[j] },
          col === 4 ? INR : null, "thin");
      }
    }
  }

  if (r === startR) {
    ws.getRow(3).height = 30;
    mergeRange(ws, "A3:F3",
      "✓ No unmatched items found — all records reconciled!",
      C.ltgrn, { color: C.green, bold: true, size: 12 },
      { h: "center", v: "middle" });
  }
}

function buildActionPlan(wb: ExcelJS.Workbook, res: ReconcileResult) {
  const ws = wb.addWorksheet("4. Action Plan", {
    properties: { tabColor: { argb: "FFED7D31" } },
    views: [{ showGridLines: false }],
  });
  setWidths(ws, { A: 4, B: 8, C: 14, D: 30, E: 44, F: 20, G: 16, H: 4 });

  ws.getRow(1).height = 40;
  mergeRange(ws, "A1:G1",
    "ACTION PLAN  —  What to do to close all gaps and reach ZERO balance",
    C.navy, { color: C.white, bold: true, size: 13 },
    { h: "center", v: "middle", wrap: true });

  hdr(ws, 2, ["#", "Priority", "Who Acts", "Action", "How To Do It",
    "Expected Outcome", "Status"], C.navy, 9);
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2, showGridLines: false }];

  type Act = { pri: "URGENT" | "MEDIUM" | "FINAL"; who: string; action: string; detail: string; outcome: string };
  const actions: Act[] = [];

  for (const p of res.unmatchedCompanyPay) {
    actions.push({
      pri: "URGENT", who: "YOU",
      action: `Confirm payment ₹${p.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${p.companyRef})`,
      detail: "Collect bank UTR / transfer receipt for this payment.\nSend proof to Business Partner and ask them to record it in their books.",
      outcome: "Business Partner's balance reduces by this amount",
    });
  }

  if (res.unmatchedPartnerInv.length > 0) {
    actions.push({
      pri: "URGENT", who: "PARTNER",
      action: "Business Partner to check invoices not in your books",
      detail: `${res.unmatchedPartnerInv.length} Business Partner invoice(s) not found in your records.\nAsk them to share these invoices and verify if they should be booked.`,
      outcome: "Gap reduces once invoices are booked or disputed",
    });
  }

  if (res.unmatchedCompanyInv.length > 0) {
    actions.push({
      pri: "MEDIUM", who: "YOU",
      action: "Check your invoices with no Business Partner match",
      detail: `${res.unmatchedCompanyInv.length} invoice(s) in your books have no matching Business Partner record.\nVerify the Business Partner's invoice number was entered correctly.`,
      outcome: "Matching improves once references are corrected",
    });
  }

  const tdsItems = res.matchedInvoices.filter((m) => m.tdsDeducted > 0);
  if (tdsItems.length > 0) {
    const totalTds = tdsItems.reduce((s, m) => s + m.tdsDeducted, 0);
    actions.push({
      pri: "MEDIUM", who: "PARTNER",
      action: `Business Partner to post TDS offset journal entries (₹${totalTds.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`,
      detail: `TDS of ₹${totalTds.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} was deducted across ${tdsItems.length} invoice(s).\nBusiness Partner must post TDS credit journal vouchers in their books (one per invoice).\nShare TDS certificate (Form 16A) with them.`,
      outcome: "Business Partner's balance reduces by the TDS amount",
    });
    actions.push({
      pri: "MEDIUM", who: "YOU",
      action: "Issue TDS Certificate (Form 16A) to Business Partner",
      detail: "Generate Form 16A for all TDS deducted and share with the Business Partner officially.",
      outcome: "Business Partner can claim TDS credit in their income tax return",
    });
  }

  actions.push({
    pri: "FINAL", who: "BOTH",
    action: "Exchange signed ledger confirmation letters",
    detail: "Once all gaps are resolved, both parties to confirm the agreed balance in writing.\nPrint both ledgers, sign and exchange as audit evidence.",
    outcome: "Reconciliation complete — zero balance confirmed",
  });

  const pri: Record<Act["pri"], [string, string]> = {
    URGENT: [C.red, C.ltred],
    MEDIUM: [C.amber, C.ltamb],
    FINAL:  [C.green, C.ltgrn],
  };

  let r = 2;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    r += 1; ws.getRow(r).height = 55;
    const [fc, fx] = pri[a.pri];
    const vals: (string | number)[] = [i + 1, a.pri, a.who, a.action, a.detail, a.outcome, "PENDING"];
    const aligns: ("left" | "center")[] = ["center", "center", "center", "left", "left", "left", "center"];
    for (let j = 0; j < vals.length; j++) {
      const col = j + 1;
      const cellFx = col < 7 ? fx : C.ltamb;
      const cellFc = [2, 3, 7].includes(col) ? fc : C.black;
      wc(ws, r, col, vals[j], cellFx,
        { color: cellFc, bold: [2, 3, 7].includes(col), size: 9 },
        { h: aligns[j], v: "top", wrap: true },
        null, "thin");
    }
  }
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function buildReport(res: ReconcileResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  buildSummary(wb, res);
  buildMatched(wb, res);
  buildGaps(wb, res);
  buildActionPlan(wb, res);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
