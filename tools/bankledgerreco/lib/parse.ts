/* Bank-statement + books-ledger parser.

   Both files are auto-detected: we scan each sheet's header row(s) and
   match column names against a candidate list per field. Same token-set
   strategy as analyze_financials.py — `Customer` matches `Customer Name`
   but not `Customer GST No.` (extra tokens score worse).

   Supports XLSX, CSV and digital PDF. The header may be on row 1 (clean
   exports), rows 2-4 (BC / Tally title bar) or ~20 rows down (HDFC-style bank
   statements with a tall account/address banner) — probeHeaders scans a wide
   window and picks the offset that finds the most candidate fields. */

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
    // Excel serial date (1900-based with the 1900 leap-year quirk). Bound it to
    // a plausible range (~1990-01-01 .. 2100-12-31) so a stray number landing in
    // the date column — e.g. a balance like -5990621.22 in a summary row — is
    // rejected instead of coercing to an absurd year and surviving as a fake txn.
    if (v < 32874 || v > 73415) return null;
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
  // Last-ditch: let Date parse — but a bare number (e.g. a balance like
  // "-5990621.22" sitting in a summary row's date cell) coerces to an absurd
  // year, so reject pure-numeric strings and clamp to a plausible range. This
  // is what stops a bank's trailing STATEMENT SUMMARY block from slipping past
  // the date filter as a fake transaction.
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  const year = dt.getUTCFullYear();
  return year >= 1990 && year <= 2100 ? dt : null;
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

/** Find the transaction header row and pick whichever candidate row matches the
 *  most fields (date + amount/description columns).
 *
 *  We scan well past the first few rows: real bank exports often prepend a tall
 *  title banner before the header — an HDFC `.xls` statement carries ~20 rows of
 *  account holder / address / statement-period / asterisk-rule lines before its
 *  "Date / Narration / Withdrawal Amt. / Deposit Amt. / Closing Balance" row.
 *  This is safe because the scan matches header *names*: data rows (dates,
 *  amounts, narrations) score zero hits, so a wider window can't mis-pick one. */
export function probeHeaders(
  matrix: SheetMatrix,
  required: string[][],
): ParsedFile {
  let best: ParsedFile = { rows: [], headers: [], headerRow: 0 };
  let bestHits = -1;

  for (let r = 0; r < Math.min(60, matrix.length); r++) {
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
  }).filter((t) =>
    // A real statement/ledger row always carries a date once a date column has
    // been detected. Requiring one here drops the trailing summary block that
    // banks append after the transactions — e.g. HDFC's "STATEMENT SUMMARY"
    // (Opening/Closing balance, total Debits/Credits, Dr/Cr counts) — whose
    // figures otherwise parse as enormous fake transactions and wreck both the
    // totals and the running-balance tie-out. With no date column detected we
    // fall back to the original amount test so amount-only formats still load.
    dateCol ? t.date !== null : (t.debit !== 0 || t.credit !== 0),
  );

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
  }).filter((t) =>
    // A real statement/ledger row always carries a date once a date column has
    // been detected. Requiring one here drops the trailing summary block that
    // banks append after the transactions — e.g. HDFC's "STATEMENT SUMMARY"
    // (Opening/Closing balance, total Debits/Credits, Dr/Cr counts) — whose
    // figures otherwise parse as enormous fake transactions and wreck both the
    // totals and the running-balance tie-out. With no date column detected we
    // fall back to the original amount test so amount-only formats still load.
    dateCol ? t.date !== null : (t.debit !== 0 || t.credit !== 0),
  );

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

// ── Running-balance tie-out ─────────────────────────────────────────────

/** ₹ with thousands separators, 2dp — for tie-out warning notes. */
function inr(n: number): string {
  return `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Verify a single file's running-balance column ties out: from one row to the
 *  next the printed balance should move by exactly the row's signed amount, so
 *  the last balance should equal the first plus the sum of every step between.
 *  When it doesn't, a row was almost certainly misread, dropped, or duplicated
 *  during parsing — most likely on the PDF path — and the headline gap can't be
 *  trusted. Returns a warning note in that case, or null when it ties out (or
 *  when there's no usable balance column to check, e.g. most CSV exports).
 *
 *  The balance's sign convention is auto-detected per file rather than assumed:
 *  a bank statement's balance moves WITH `signed` (credit − debit), but a books
 *  bank-ledger export often moves the opposite way. We pick whichever direction
 *  fits the majority of steps (same idea as parse-company-pdf.ts's "try both
 *  interpretations"), so the check works for either side without hard-coding.
 *
 *  Rows are walked in file order (running balance is sequential in the source —
 *  never sorted). A null balance breaks the chain, so we re-anchor on the next
 *  row that has one and only tie out within each contiguous run. */
export function checkRunningBalance(
  txns: Array<{ signed: number; balance: number | null; fileRow: number }>,
  file: string,
): string | null {
  const TOL = 0.5; // rupees — absorb rounding noise, not a dropped row
  const withBal = txns.filter((t) => t.balance != null);
  // Not enough of a balance column to say anything meaningful.
  if (withBal.length < 3 || withBal.length < txns.length * 0.6) return null;

  // Detect the sign convention: does the balance move with `signed` or against it?
  let agree = 0;
  let prev: { signed: number; balance: number } | null = null;
  for (const t of txns) {
    if (t.balance == null) { prev = null; continue; }
    if (prev) {
      const delta = t.balance - prev.balance;
      if (Math.abs(delta - t.signed) <= TOL) agree += 1;
      else if (Math.abs(delta + t.signed) <= TOL) agree -= 1;
    }
    prev = { signed: t.signed, balance: t.balance };
  }
  const sign = agree >= 0 ? 1 : -1;

  // Walk each contiguous run of balance-bearing rows and accumulate the residual.
  let residual = 0;
  let breakRow: number | null = null;
  prev = null;
  for (const t of txns) {
    if (t.balance == null) { prev = null; continue; }
    if (prev) {
      const expected = sign * t.signed;
      const step = t.balance - prev.balance - expected;
      if (Math.abs(step) > TOL && breakRow == null) breakRow = t.fileRow;
      residual += step;
    }
    prev = { signed: t.signed, balance: t.balance };
  }

  if (Math.abs(residual) <= TOL) return null;

  // residual = (printed last balance) − (balance implied by the rows). Report the
  // implied vs printed closing so the user can see the size and direction of the gap.
  const last = withBal[withBal.length - 1].balance as number;
  const implied = last - residual;
  const near = breakRow != null ? ` First mismatch near row ${breakRow}.` : "";
  return (
    `⚠ ${file}: running balance doesn't tie out — the rows add up to a closing of ` +
    `${inr(implied)} but the statement shows ${inr(last)} (off by ${inr(Math.abs(residual))}). ` +
    `A row may have been misread or dropped while parsing${near} — re-check this file before trusting the gap.`
  );
}
