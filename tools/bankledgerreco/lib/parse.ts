/* Bank-statement + books-ledger parser.

   Both files are auto-detected: we scan each sheet's header row(s) and
   match column names against a candidate list per field. Same token-set
   strategy as analyze_financials.py — `Customer` matches `Customer Name`
   but not `Customer GST No.` (extra tokens score worse).

   Supports XLSX and CSV. Header is normally on row 1 (banks) or rows
   2-4 (BC / Tally exports with a title bar) — we try the first few
   header offsets and pick the one that finds the most candidate fields. */

import * as XLSX from "xlsx";
import type { BankTxn, BooksTxn, FileSource } from "./types";

// ── Column candidates ──────────────────────────────────────────────────

const DATE_KEYS = [
  "Posting Date", "Transaction Date", "Txn Date", "Value Date",
  "Date", "Tran Date", "Booking Date", "Effective Date",
];

const DESC_KEYS = [
  "Description", "Particulars", "Narration", "Narrative",
  "Details", "Transaction Details", "Remarks", "Memo",
  "Posting Description",
];

const DEBIT_KEYS = [
  "Withdrawal Amt.", "Withdrawal", "Debit Amount", "Debit",
  "Dr", "Dr Amount", "Withdrawals", "Paid Out", "Money Out",
];

const CREDIT_KEYS = [
  "Deposit Amt.", "Deposit", "Credit Amount", "Credit",
  "Cr", "Cr Amount", "Deposits", "Paid In", "Money In",
];

const AMOUNT_KEYS = [
  "Amount", "Transaction Amount", "Txn Amount", "Net Amount",
];

const DRCR_KEYS = [
  "Dr/Cr", "Dr Cr", "Type", "Transaction Type", "Txn Type",
];

const BALANCE_KEYS = [
  "Running Balance", "Closing Balance", "Balance", "Available Balance",
];

// ── Token-set fuzzy lookup ─────────────────────────────────────────────

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
  );
}

export function pickHeader(
  headers: string[],
  candidates: string[],
): string | null {
  if (!headers.length) return null;
  const headerTokens = headers.map((h) => ({ h, tok: tokenize(h) }));

  // Exact (case-insensitive) match wins.
  for (const cand of candidates) {
    const candLow = cand.toLowerCase();
    const hit = headerTokens.find((x) => x.h.toLowerCase() === candLow);
    if (hit) return hit.h;
  }

  // Token-set match: candidate tokens ⊆ header tokens. Prefer fewest extras.
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
  // Strip commas, currency markers, trailing CR/DR
  const cleaned = String(v).replace(/[,\s₹$]/g, "").replace(/(CR|DR)$/i, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return isFinite(n) ? n : 0;
}

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date (1900-based with the 1900 leap-year quirk).
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  // Try several Indian-bank-friendly formats.
  for (const fmt of [
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,        // YYYY-MM-DD
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/,  // DD/MM/YYYY or DD-MM-YYYY
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/,  // DD/MM/YY
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
  // Last-ditch: let Date parse.
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

// ── Header-row probing ─────────────────────────────────────────────────

type SheetMatrix = unknown[][];

export function readMatrix(buffer: Buffer): SheetMatrix {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
}

/** "%PDF-" magic bytes. */
function isPdf(buf: Buffer): boolean {
  return buf.length >= 5 &&
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d;
}

/** Read XLSX/CSV (sync) or extract a matrix from a digital PDF (async). The
 *  PDF extractor is dynamically imported so the XLSX/CSV path never loads it. */
export async function readMatrixAny(buffer: Buffer): Promise<SheetMatrix> {
  if (isPdf(buffer)) {
    const { pdfToMatrix } = await import("./pdf");
    return pdfToMatrix(buffer);
  }
  return readMatrix(buffer);
}

type ParsedFile = {
  rows: Record<string, unknown>[];
  headers: string[];
  headerRow: number;
};

/** Try header rows 0..4 and pick whichever finds the most candidate
 *  fields (date + at least one amount column). */
export function probeHeaders(
  matrix: SheetMatrix,
  required: string[][],
): ParsedFile {
  let best: ParsedFile = { rows: [], headers: [], headerRow: 0 };
  let bestHits = -1;

  for (let r = 0; r < Math.min(5, matrix.length); r++) {
    const headers = (matrix[r] ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
    if (!headers.length) continue;
    const hits = required.reduce(
      (n, cands) => n + (pickHeader(headers, cands) ? 1 : 0),
      0,
    );
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

export async function parseBankStatement(buffer: Buffer): Promise<{
  txns: BankTxn[];
  columns: Record<string, string | null>;
  headers: string[];
}> {
  const matrix = await readMatrixAny(buffer);
  const { rows, headers } = probeHeaders(matrix, [
    DATE_KEYS, DEBIT_KEYS, CREDIT_KEYS, DESC_KEYS,
  ]);

  const dateCol = pickHeader(headers, DATE_KEYS);
  const descCol = pickHeader(headers, DESC_KEYS);
  const debitCol = pickHeader(headers, DEBIT_KEYS);
  const creditCol = pickHeader(headers, CREDIT_KEYS);
  const amtCol = pickHeader(headers, AMOUNT_KEYS);
  const drcrCol = pickHeader(headers, DRCR_KEYS);
  const balCol = pickHeader(headers, BALANCE_KEYS);

  const txns: BankTxn[] = rows.map((r, i) => {
    const date = dateCol ? toDate(r[dateCol]) : null;
    const description = descCol ? String(r[descCol] ?? "").trim() : "";
    let debit = debitCol ? toNum(r[debitCol]) : 0;
    let credit = creditCol ? toNum(r[creditCol]) : 0;
    // Single Amount + Dr/Cr type column → split into debit/credit.
    if (!debit && !credit && amtCol) {
      const amt = toNum(r[amtCol]);
      const type = drcrCol ? String(r[drcrCol] ?? "").trim().toUpperCase() : "";
      if (type.startsWith("D")) debit = amt;
      else credit = amt;
    }
    return {
      // Per-file row now; mergeTxns reassigns a global `row` and stamps `file`.
      row: i + 1,
      file: "",
      fileRow: i + 1,
      date,
      description,
      debit,
      credit,
      signed: credit - debit,
      balance: balCol ? toNum(r[balCol]) : null,
    };
  }).filter((t) => t.date !== null || t.debit !== 0 || t.credit !== 0);

  return {
    txns,
    columns: {
      date: dateCol, description: descCol, debit: debitCol, credit: creditCol,
      amount: amtCol, drcr: drcrCol, balance: balCol,
    },
    headers,
  };
}

export async function parseBooksLedger(buffer: Buffer): Promise<{
  txns: BooksTxn[];
  columns: Record<string, string | null>;
  headers: string[];
}> {
  const matrix = await readMatrixAny(buffer);
  const { rows, headers } = probeHeaders(matrix, [
    DATE_KEYS, DEBIT_KEYS, CREDIT_KEYS, DESC_KEYS,
  ]);

  const dateCol = pickHeader(headers, DATE_KEYS);
  const descCol = pickHeader(headers, DESC_KEYS);
  const debitCol = pickHeader(headers, DEBIT_KEYS);
  const creditCol = pickHeader(headers, CREDIT_KEYS);
  const amtCol = pickHeader(headers, AMOUNT_KEYS);
  const drcrCol = pickHeader(headers, DRCR_KEYS);
  const balCol = pickHeader(headers, BALANCE_KEYS);

  const txns: BooksTxn[] = rows.map((r, i) => {
    const date = dateCol ? toDate(r[dateCol]) : null;
    const description = descCol ? String(r[descCol] ?? "").trim() : "";
    let debit = debitCol ? toNum(r[debitCol]) : 0;
    let credit = creditCol ? toNum(r[creditCol]) : 0;
    if (!debit && !credit && amtCol) {
      const amt = toNum(r[amtCol]);
      const type = drcrCol ? String(r[drcrCol] ?? "").trim().toUpperCase() : "";
      if (type.startsWith("D")) debit = amt;
      else credit = amt;
    }
    return {
      // Per-file row now; mergeTxns reassigns a global `row` and stamps `file`.
      row: i + 1,
      file: "",
      fileRow: i + 1,
      date,
      description,
      debit,
      credit,
      // Books: Dr = money in, Cr = money out. Signed: net inflow.
      signed: debit - credit,
      balance: balCol ? toNum(r[balCol]) : null,
    };
  }).filter((t) => t.date !== null || t.debit !== 0 || t.credit !== 0);

  return {
    txns,
    columns: {
      date: dateCol, description: descCol, debit: debitCol, credit: creditCol,
      amount: amtCol, drcr: drcrCol, balance: balCol,
    },
    headers,
  };
}

// ── Multi-file merge ────────────────────────────────────────────────────

type Mergeable = { row: number; file: string; fileRow: number };

/** YYYY-MM-DD in UTC (dates are constructed UTC-based in toDate). */
function fmtDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/** Concatenate the parsed rows of several files into one side's dataset.
 *
 *  Rows are numbered globally in FILE ORDER (file 1 → rows 1..n1, file 2 →
 *  n1+1.., …) so each file occupies a CONTIGUOUS global range — that keeps the
 *  "files merged" legend accurate and any global row number traceable to a
 *  file. The matcher is order-independent (it keys off `row` and sorts inside
 *  each pass), so file order vs date order does not affect matching. Each row
 *  keeps its source `file` and within-file `fileRow` for "see <file> row N".
 *
 *  Files whose date ranges overlap are flagged in `notes` (possible
 *  double-counting) but never dropped — identical same-day rows can be real. */
export function mergeTxns<T extends Mergeable>(
  parts: Array<{ file: string; txns: T[] }>,
  getDate: (t: T) => Date | null = () => null,
): { merged: T[]; sources: FileSource[]; notes: string[] } {
  const merged: T[] = [];
  const sources: FileSource[] = [];
  let g = 0;

  for (const { file, txns } of parts) {
    const rowStart = g + 1;
    for (const t of txns) {
      g += 1;
      // fileRow already carries the per-file number from the parser.
      merged.push({ ...t, file, row: g });
    }
    sources.push({ file, rows: txns.length, rowStart, rowEnd: g });
  }

  // Overlapping date ranges between files → warn (don't dedup).
  const ranges = parts.map(({ file, txns }) => {
    let min: Date | null = null, max: Date | null = null;
    for (const t of txns) {
      const d = getDate(t);
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    return { file, min, max };
  });
  const notes: string[] = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i], b = ranges[j];
      if (a.min && a.max && b.min && b.max && a.min <= b.max && b.min <= a.max) {
        const from = a.min > b.min ? a.min : b.min;
        const to = a.max < b.max ? a.max : b.max;
        notes.push(
          `${a.file} and ${b.file} overlap ${fmtDay(from)}–${fmtDay(to)} — check for double-counted rows.`,
        );
      }
    }
  }

  return { merged, sources, notes };
}
