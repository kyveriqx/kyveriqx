/* Sales / Purchase Register parser.

   The books side of GST reco — what Tally / Business Central / Zoho /
   Excel exports look like. Same auto-detect header strategy as the bank-
   ledger parser: scan the first few rows for the best-matching header
   row, then map every candidate field to whatever the user's export
   called it ("Party GSTIN" vs "Supplier GSTIN" vs "GST No.").

   v1 only reads invoice-level totals — line-level HSN matching is a
   separate engine. Required columns: GSTIN, invoice number, invoice
   date, taxable value, and either a single tax total OR the per-head
   IGST/CGST/SGST trio. Cess is optional; invoice value is derived if
   not present. */

import * as XLSX from "xlsx";
import type { FileSource, GstInvoice, GstReturn } from "./types";
import { normalizeGstin, normalizeInvoiceNo } from "./types";

// ── Column candidates ──────────────────────────────────────────────────

const GSTIN_KEYS = [
  "Party GSTIN", "Supplier GSTIN", "Customer GSTIN", "Counterparty GSTIN",
  "GSTIN", "GST No", "GST Number", "GSTIN/UIN", "GSTIN UIN",
];

// Name-bearing columns first ("Trade/Legal name" is the GSTN portal header);
// the bare "Supplier"/"Customer"/"Party" fallbacks come last so they don't
// accidentally latch onto a "GSTIN of supplier" column before "Name" matches.
const PARTY_KEYS = [
  "Party Name", "Supplier Name", "Customer Name", "Counterparty Name",
  "Trade/Legal name", "Trade Name", "Legal Name", "Name",
  "Party", "Supplier", "Customer",
];

// Order matters: pickHeader returns the first candidate that *exactly* matches
// a header. A GSTR-2B is keyed on the SUPPLIER's invoice number, never the
// buyer's internal document/voucher number — so supplier/vendor invoice columns
// come first and the ERP's own "Document No" / "Voucher No" are last-resort
// fallbacks (used only when no real invoice-number column is present).
const INVOICE_NO_KEYS = [
  "Supplier Invoice No", "Vendor Invoice No", "Party Invoice No",
  "Invoice No", "Invoice Number", "Invoice #", "Inv No", "Inv #",
  "Bill No", "Bill Number", "Reference No", "Document No", "Voucher No",
];

const INVOICE_DATE_KEYS = [
  "Invoice Date", "Inv Date", "Bill Date", "Document Date", "Voucher Date",
  "Date", "Posting Date", "Transaction Date",
];

const TAXABLE_KEYS = [
  "Taxable Value", "Taxable Amount", "Taxable", "Assessable Value",
  "Net Amount", "Net Value", "Basic Amount", "Base Amount",
];

// "Integrated/Central/State-UT Tax" are the column names on the official
// GSTN portal XLSX (GSTR-2B/2A) — the rest cover Tally/BC/Zoho exports.
const IGST_KEYS = ["IGST", "IGST Amount", "Integrated GST", "Integrated Tax", "IGST Amt"];
const CGST_KEYS = ["CGST", "CGST Amount", "Central GST", "Central Tax", "CGST Amt"];
const SGST_KEYS = ["SGST", "SGST Amount", "State GST", "State/UT Tax", "State Tax", "SGST/UTGST", "UTGST", "SGST Amt"];
const CESS_KEYS = ["Cess", "Cess Amount", "Compensation Cess", "Cess Amt"];

const TAX_TOTAL_KEYS = [
  "Tax Amount", "Total Tax", "GST Amount", "GST", "Total GST",
];

const INVOICE_VALUE_KEYS = [
  "Invoice Value", "Invoice Total", "Total Invoice Value", "Total Amount",
  "Gross Amount", "Bill Amount", "Document Total",
];

// ── Token-set fuzzy lookup ─────────────────────────────────────────────

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

export function pickHeader(headers: string[], candidates: string[]): string | null {
  if (!headers.length) return null;
  const headerTokens = headers.map((h) => ({ h, tok: tokenize(h) }));

  for (const cand of candidates) {
    const candLow = cand.toLowerCase();
    const hit = headerTokens.find((x) => x.h.toLowerCase() === candLow);
    if (hit) return hit.h;
  }

  let best: { h: string; extras: number } | null = null;
  for (const cand of candidates) {
    const candTok = tokenize(cand);
    if (!candTok.size) continue;
    for (const { h, tok } of headerTokens) {
      let subset = true;
      for (const t of candTok) {
        if (!tok.has(t)) { subset = false; break; }
      }
      if (!subset) continue;
      const extras = tok.size - candTok.size;
      if (best === null || extras < best.extras) best = { h, extras };
    }
    if (best) return best.h;
  }
  return null;
}

// ── Value coercion ─────────────────────────────────────────────────────

export function toNum(v: unknown): number {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v == null || v === "") return 0;
  const cleaned = String(v).replace(/[,\s₹$]/g, "").replace(/(CR|DR)$/i, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  for (const fmt of [
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/,
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/,
  ]) {
    const m = s.match(fmt);
    if (m) {
      let y: number, mo: number, d: number;
      if (fmt.source.startsWith("^(\\d{4})")) {
        y = +m[1]; mo = +m[2]; d = +m[3];
      } else {
        d = +m[1]; mo = +m[2]; y = +m[3];
        if (y < 100) y += 2000;
      }
      const dt = new Date(Date.UTC(y, mo - 1, d));
      return isNaN(dt.getTime()) ? null : dt;
    }
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

// ── Sheet → matrix → row dicts ─────────────────────────────────────────

type SheetMatrix = unknown[][];

/** Choose which sheet holds the invoice rows.
 *
 *  The official GSTN portal export (GSTR-2B / 2A) is a multi-sheet workbook
 *  whose FIRST sheet is "Read me" — the invoices live on the "B2B" sheet. We
 *  only reroute when the workbook is unmistakably a GSTN export (it has a
 *  "Read me" sheet AND a "B2B" sheet), so an ordinary single-sheet
 *  Tally/BC/Zoho register still reads its first sheet exactly as before. */
function pickSheetName(wb: XLSX.WorkBook): string {
  const names = wb.SheetNames;
  const isGstnExport = names.some((n) => n.replace(/\s+/g, "").toLowerCase() === "readme");
  if (isGstnExport) {
    const b2b = names.find((n) => n.trim().toUpperCase() === "B2B");
    if (b2b) return b2b;
  }
  return names[0] ?? "";
}

export function readMatrix(buffer: Buffer): SheetMatrix {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = pickSheetName(wb);
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
}

type ParsedFile = {
  rows: Record<string, unknown>[];
  headers: string[];
  headerRow: number;
};

export function probeHeaders(matrix: SheetMatrix, required: string[][]): ParsedFile {
  let best: ParsedFile = { rows: [], headers: [], headerRow: 0 };
  let bestHits = -1;
  for (let r = 0; r < Math.min(6, matrix.length); r++) {
    const headers = (matrix[r] ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
    if (!headers.length) continue;
    const hits = required.reduce((n, cands) => n + (pickHeader(headers, cands) ? 1 : 0), 0);
    if (hits > bestHits) {
      bestHits = hits;
      const headerArr = (matrix[r] ?? []).map((c) => String(c ?? "").trim());
      const rows: Record<string, unknown>[] = [];
      for (let i = r + 1; i < matrix.length; i++) {
        const row = matrix[i] ?? [];
        if (row.every((v) => v === "" || v == null)) continue;
        const rec: Record<string, unknown> = {};
        headerArr.forEach((h, idx) => { if (h) rec[h] = row[idx]; });
        rows.push(rec);
      }
      best = { rows, headers: headerArr.filter(Boolean), headerRow: r };
    }
  }
  return best;
}

// ── Public entry points ────────────────────────────────────────────────

export type RegisterParseResult = {
  invoices: GstInvoice[];
  columns: Record<string, string | null>;
  headers: string[];
  /** Pre-aggregation row count, for "N line rows → M invoices" display.
   *  Equals invoices.length when the register is already invoice-level. */
  lineRows?: number;
};

/** Collapse line-level register rows to invoice level.
 *
 *  Indian ERP exports (Business Central, Tally, Zoho) often emit one row per
 *  invoice *line* — a single invoice spans many HSN/item rows. GST ITC is
 *  claimed at invoice granularity and the matcher consumes each 2B row once,
 *  so without this collapse every line after the first becomes a false
 *  "missing-in-2b" exception.
 *
 *  Groups rows sharing (partyGstin, normalizeInvoiceNo(invoiceNo)) ONLY when
 *  both keys are non-empty — a row we can't identify is passed through
 *  untouched (it can't be safely merged, and will surface as its own
 *  exception). Sums every money field; keeps the first row's
 *  date/file/fileRow/source; prefers the longest non-empty partyName; records
 *  how many lines were merged. First-seen order is preserved so downstream row
 *  numbering stays stable. A register that is already invoice-level is a
 *  no-op (every key is unique). */
export function aggregateRegister(invoices: GstInvoice[]): GstInvoice[] {
  const byKey = new Map<string, GstInvoice>();
  const out: GstInvoice[] = [];

  for (const inv of invoices) {
    const keyable = inv.partyGstin !== "" && inv.invoiceNo !== "";
    if (!keyable) {
      out.push({ ...inv, mergedLines: 1 });
      continue;
    }
    const k = `${inv.partyGstin}::${normalizeInvoiceNo(inv.invoiceNo)}`;
    const existing = byKey.get(k);
    if (!existing) {
      // Push the live seed object that we keep mutating, so `out` stays in
      // first-seen order without a second pass.
      const seed: GstInvoice = { ...inv, mergedLines: 1 };
      byKey.set(k, seed);
      out.push(seed);
      continue;
    }
    existing.taxableValue += inv.taxableValue;
    existing.igst += inv.igst;
    existing.cgst += inv.cgst;
    existing.sgst += inv.sgst;
    existing.cess += inv.cess;
    existing.totalTax += inv.totalTax;
    existing.invoiceValue += inv.invoiceValue;
    existing.mergedLines = (existing.mergedLines ?? 1) + 1;
    if (inv.partyName && inv.partyName.length > existing.partyName.length) {
      existing.partyName = inv.partyName;
    }
    if (!existing.invoiceDate && inv.invoiceDate) existing.invoiceDate = inv.invoiceDate;
  }
  return out;
}

function parseRegister(
  buffer: Buffer,
  filename: string,
  source: GstReturn,
): RegisterParseResult {
  const matrix = readMatrix(buffer);
  const { rows, headers } = probeHeaders(matrix, [
    GSTIN_KEYS, INVOICE_NO_KEYS, INVOICE_DATE_KEYS, TAXABLE_KEYS,
  ]);

  const gstinCol = pickHeader(headers, GSTIN_KEYS);
  const partyCol = pickHeader(headers, PARTY_KEYS);
  const invNoCol = pickHeader(headers, INVOICE_NO_KEYS);
  const invDateCol = pickHeader(headers, INVOICE_DATE_KEYS);
  const taxableCol = pickHeader(headers, TAXABLE_KEYS);
  const igstCol = pickHeader(headers, IGST_KEYS);
  const cgstCol = pickHeader(headers, CGST_KEYS);
  const sgstCol = pickHeader(headers, SGST_KEYS);
  const cessCol = pickHeader(headers, CESS_KEYS);
  const taxTotalCol = pickHeader(headers, TAX_TOTAL_KEYS);
  const invValueCol = pickHeader(headers, INVOICE_VALUE_KEYS);

  const invoices: GstInvoice[] = [];
  rows.forEach((r, i) => {
    const partyGstin = gstinCol ? normalizeGstin(String(r[gstinCol] ?? "")) : "";
    const invoiceNo = invNoCol ? String(r[invNoCol] ?? "").trim() : "";
    const invoiceDate = invDateCol ? toDate(r[invDateCol]) : null;
    const taxableValue = taxableCol ? toNum(r[taxableCol]) : 0;

    // Skip noise rows: no GSTIN AND no invoice number AND no taxable value.
    if (!partyGstin && !invoiceNo && taxableValue === 0) return;

    const igst = igstCol ? toNum(r[igstCol]) : 0;
    const cgst = cgstCol ? toNum(r[cgstCol]) : 0;
    const sgst = sgstCol ? toNum(r[sgstCol]) : 0;
    const cess = cessCol ? toNum(r[cessCol]) : 0;
    let totalTax = igst + cgst + sgst + cess;
    // Fall back to the single Tax-Amount column if the per-head split
    // isn't present in the export.
    if (totalTax === 0 && taxTotalCol) totalTax = toNum(r[taxTotalCol]);
    const invoiceValue = invValueCol ? toNum(r[invValueCol]) : taxableValue + totalTax;

    invoices.push({
      row: i + 1,
      file: filename,
      fileRow: i + 1,
      source,
      partyGstin,
      partyName: partyCol ? String(r[partyCol] ?? "").trim() : "",
      invoiceNo,
      invoiceDate,
      taxableValue,
      igst,
      cgst,
      sgst,
      cess,
      totalTax,
      invoiceValue,
      itcEligible: null,
      itcReason: null,
      filedAt: null,
    });
  });

  const lineRows = invoices.length;
  const aggregated = aggregateRegister(invoices);

  return {
    invoices: aggregated,
    columns: {
      gstin: gstinCol, party: partyCol, invoiceNo: invNoCol, invoiceDate: invDateCol,
      taxable: taxableCol, igst: igstCol, cgst: cgstCol, sgst: sgstCol, cess: cessCol,
      taxTotal: taxTotalCol, invoiceValue: invValueCol,
    },
    headers,
    lineRows,
  };
}

export function parsePurchaseRegister(buffer: Buffer, filename: string): RegisterParseResult {
  return parseRegister(buffer, filename, "purchase");
}

export function parseSalesRegister(buffer: Buffer, filename: string): RegisterParseResult {
  return parseRegister(buffer, filename, "sales");
}

// ── Multi-file merge ────────────────────────────────────────────────────

/** Concatenate the parsed invoices of several files into one side's
 *  dataset, reassigning a global `row` number per side so it stays
 *  traceable to a file + per-file row. Mirrors bankledgerreco.mergeTxns
 *  but keyed for invoices, not transactions. */
export function mergeInvoices(
  parts: Array<{ file: string; invoices: GstInvoice[] }>,
): { merged: GstInvoice[]; sources: FileSource[] } {
  const merged: GstInvoice[] = [];
  const sources: FileSource[] = [];
  let g = 0;
  for (const { file, invoices } of parts) {
    const rowStart = g + 1;
    for (const inv of invoices) {
      g += 1;
      merged.push({ ...inv, file, row: g });
    }
    sources.push({ file, rows: invoices.length, rowStart, rowEnd: g });
  }
  return { merged, sources };
}
