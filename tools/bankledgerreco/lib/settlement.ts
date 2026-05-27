/* Razorpay (or similar gateway) settlement-report parser.

   A settlement report lists, per settlement, the NET amount that hit the
   bank plus the fee + GST that were deducted. With it we can reconcile a
   single bank credit back to its gross book entries and show the EXACT fee
   instead of inferring it.

   Reuses the header-probing + value coercion from parse.ts so a new column
   layout doesn't need its own parser. Shape targeted: Razorpay "Settlements"
   export — id/utr, amount (net settled), fees, tax, created_at. */

import type { SettlementRow } from "./types";
import { readMatrix, probeHeaders, pickHeader, toNum, toDate } from "./parse";

const UTR_KEYS = [
  "settlement_utr", "Settlement UTR", "utr", "UTR", "RRN", "reference id",
  "settlement id", "settlement_id",
];
// Net amount credited to the bank for this settlement.
const AMOUNT_KEYS = [
  "amount", "Settlement Amount", "settled_amount", "net amount", "net_amount",
  "amount settled",
];
const FEE_KEYS = [
  "fees", "fee", "Razorpay Fees", "gateway fee", "commission",
];
const TAX_KEYS = [
  "tax", "GST", "gst", "tax amount",
];
const DATE_KEYS = [
  "created_at", "settled_at", "Settlement Date", "settled_on", "date",
];

export function parseSettlementReport(buffer: Buffer): {
  rows: SettlementRow[];
  columns: Record<string, string | null>;
  headers: string[];
} {
  const matrix = readMatrix(buffer);
  const { rows, headers } = probeHeaders(matrix, [AMOUNT_KEYS, FEE_KEYS, UTR_KEYS]);

  const utrCol = pickHeader(headers, UTR_KEYS);
  const amtCol = pickHeader(headers, AMOUNT_KEYS);
  const feeCol = pickHeader(headers, FEE_KEYS);
  const taxCol = pickHeader(headers, TAX_KEYS);
  const dateCol = pickHeader(headers, DATE_KEYS);

  const parsed: SettlementRow[] = rows
    .map((r, i) => ({
      // Per-file row now; mergeTxns reassigns a global `row` and stamps `file`.
      row: i + 1,
      file: "",
      fileRow: i + 1,
      utr: utrCol ? String(r[utrCol] ?? "").trim() || null : null,
      settledAt: dateCol ? toDate(r[dateCol]) : null,
      amount: amtCol ? toNum(r[amtCol]) : 0,
      fee: feeCol ? toNum(r[feeCol]) : 0,
      tax: taxCol ? toNum(r[taxCol]) : 0,
    }))
    .filter((s) => s.amount !== 0);

  return {
    rows: parsed,
    columns: { utr: utrCol, amount: amtCol, fee: feeCol, tax: taxCol, date: dateCol },
    headers,
  };
}
