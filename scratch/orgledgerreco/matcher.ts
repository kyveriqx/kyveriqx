/* Inter-entity / org ledger matcher — scratchpad version.
   Pure function. No I/O, no async, no external deps beyond types.
   Iterate this freely; when results look right against real data,
   promote to core/lib/match-ledgers.ts. */

import type { Row } from "./parse";

export type MatcherConfig = {
  /** Column name used as the matching key (e.g. "Voucher No", "Invoice No"). */
  keyColumn: string;
  /** Column holding the transaction amount. Used for amount diff classification. */
  amountColumn?: string;
  /** Column holding the transaction date. Used for date diff classification. */
  dateColumn?: string;
  /** Two rows with the same key are considered "agreeing" if their amounts
   *  differ by no more than this (absolute, in the same units as the file). */
  amountTolerance?: number;
};

export type MatchPair = { a: Row; b: Row; reasons: string[] };

export type MatchResult = {
  matched: MatchPair[];     // same key, no significant disagreement
  mismatched: MatchPair[];  // same key, but amount / date differs
  onlyInA: Row[];           // key present in A's ledger, absent in B's
  onlyInB: Row[];           // key present in B's ledger, absent in A's
  stats: {
    aRowCount: number;
    bRowCount: number;
    keyColumnPresentInA: boolean;
    keyColumnPresentInB: boolean;
    aRowsMissingKey: number;
    bRowsMissingKey: number;
  };
};

function normalizeKey(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s.toLowerCase();
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[, ₹$]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function matchLedgers(
  aRows: Row[],
  bRows: Row[],
  config: MatcherConfig,
): MatchResult {
  const { keyColumn, amountColumn, dateColumn, amountTolerance = 0.01 } = config;

  // Index B by key for O(1) lookups.
  const bByKey = new Map<string, Row[]>();
  let bRowsMissingKey = 0;
  for (const row of bRows) {
    const key = normalizeKey(row[keyColumn]);
    if (key == null) {
      bRowsMissingKey++;
      continue;
    }
    const bucket = bByKey.get(key);
    if (bucket) bucket.push(row);
    else bByKey.set(key, [row]);
  }

  const matched: MatchPair[] = [];
  const mismatched: MatchPair[] = [];
  const onlyInA: Row[] = [];
  const consumedBKeys = new Set<string>();
  let aRowsMissingKey = 0;

  for (const aRow of aRows) {
    const key = normalizeKey(aRow[keyColumn]);
    if (key == null) {
      aRowsMissingKey++;
      continue;
    }
    const bMatches = bByKey.get(key);
    if (!bMatches || bMatches.length === 0) {
      onlyInA.push(aRow);
      continue;
    }
    // Naive: pair with the first matching B row, mark whole key consumed.
    // Iterate this when you see duplicate-key cases in real data.
    const bRow = bMatches[0];
    consumedBKeys.add(key);

    const reasons: string[] = [];
    if (amountColumn) {
      const aAmt = toNumber(aRow[amountColumn]);
      const bAmt = toNumber(bRow[amountColumn]);
      if (aAmt != null && bAmt != null && Math.abs(aAmt - bAmt) > amountTolerance) {
        reasons.push(`amount: A=${aAmt} vs B=${bAmt}`);
      }
    }
    if (dateColumn) {
      const aDate = String(aRow[dateColumn] ?? "").trim();
      const bDate = String(bRow[dateColumn] ?? "").trim();
      if (aDate && bDate && aDate !== bDate) {
        reasons.push(`date: A=${aDate} vs B=${bDate}`);
      }
    }

    if (reasons.length === 0) {
      matched.push({ a: aRow, b: bRow, reasons: [] });
    } else {
      mismatched.push({ a: aRow, b: bRow, reasons });
    }
  }

  // Anything in B whose key was never consumed is only-in-B.
  const onlyInB: Row[] = [];
  for (const [key, rows] of bByKey.entries()) {
    if (!consumedBKeys.has(key)) onlyInB.push(...rows);
  }

  return {
    matched,
    mismatched,
    onlyInA,
    onlyInB,
    stats: {
      aRowCount: aRows.length,
      bRowCount: bRows.length,
      keyColumnPresentInA: aRows.length === 0 || keyColumn in aRows[0],
      keyColumnPresentInB: bRows.length === 0 || keyColumn in bRows[0],
      aRowsMissingKey,
      bRowsMissingKey,
    },
  };
}
