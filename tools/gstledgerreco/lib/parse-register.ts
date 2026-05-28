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
import { normalizeGstin } from "./types";

// ── Column candidates ──────────────────────────────────────────────────

const GSTIN_KEYS = [
  "Party GSTIN", "Supplier GSTIN", "Customer GSTIN", "Counterparty GSTIN",
  "GSTIN", "GST No", "GST Number", "GSTIN/UIN", "GSTIN UIN",
];

const PARTY_KEYS = [
  "Party Name", "Supplier Name", "Customer Name", "Counterparty Name",
  "Party", "Supplier", "Customer", "Name",
];

const INVOICE_NO_KEYS = [
  "Invoice No", "Invoice Number", "Invoice #", "Inv No", "Inv #",
  "Bill No", "Bill Number", "Document No", "Voucher No", "Reference No",
  "Supplier Invoice No",
];

const INVOICE_DATE_KEYS = [
  "Invoice Date", "Inv Date", "Bill Date", "Document Date", "Voucher Date",
  "Date", "Posting Date", "Transaction Date",
];

const TAXABLE_KEYS = [
  "Taxable Value", "Taxable Amount", "Taxable", "Assessable Value",
  "Net Amount", "Net Value", "Basic Amount", "Base Amount",
];

const IGST_KEYS = ["IGST", "IGST Amount", "Integrated GST", "IGST Amt"];
const CGST_KEYS = ["CGST", "CGST Amount", "Central GST", "CGST Amt"];
const SGST_KEYS = ["SGST", "SGST Amount", "State GST", "SGST/UTGST", "UTGST", "SGST Amt"];
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

export function readMatrix(buffer: Buffer): SheetMatrix {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
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
};

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

  return {
    invoices,
    columns: {
      gstin: gstinCol, party: partyCol, invoiceNo: invNoCol, invoiceDate: invDateCol,
      taxable: taxableCol, igst: igstCol, cgst: cgstCol, sgst: sgstCol, cess: cessCol,
      taxTotal: taxTotalCol, invoiceValue: invValueCol,
    },
    headers,
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
