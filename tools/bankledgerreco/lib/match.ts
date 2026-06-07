/* Multi-pass bank reconciliation engine.

   The bank statement and the user's books view the same account from
   opposite sides, normalised to a SIGNED amount (positive = inflow):
     bank.signed  = credit - debit
     books.signed = debit  - credit
   So equal signed amounts on both sides are the same money moving the same
   way, and matching never crosses inflow with outflow.

   Real bank data is not 1:1, so we run passes from highest to lowest
   confidence; each pass only touches rows still unmatched (greedy, a row is
   never reused):

     0. settlement   — reconcile an uploaded Razorpay settlement (exact fee)
     1. exact 1:1    — same date, exact amount
     2. date-tolerant 1:1 — exact amount, date within ±window
     3. reversals    — equal-and-opposite pair on one side nets to zero
     4. group-exact  — N rows ↔ 1 row summing exactly (UPI day-aggregation,
                       and the reverse: one invoice paid in instalments)
     5. group-fee    — N book rows minus a plausible gateway fee = 1 bank
                       credit (Razorpay/POS settlements, fee inferred)
     6. classify     — label leftover bank lines (charge / interest / TDS)

   Channel + date-window + same-direction filtering keeps the subset-sum
   search in passes 4/5 small in practice. */

import type {
  BankTxn, BooksTxn, SettlementRow,
  MatchGroup, MatchMethod, Confidence, UnmatchedSide,
  ReconcileSummary, ReconcileOptions, BankReconcileResult,
} from "./types";
import { DEFAULT_OPTIONS } from "./types";
import { detectChannel, isGateway, classifyUnmatched, looksLikeReversal } from "./classify";

// ── small helpers ──────────────────────────────────────────────────────

const cents = (n: number) => Math.round(n * 100);
const r2 = (n: number) => Math.round(n * 100) / 100;
const MS_DAY = 86400000;

function ymd(d: Date | null): string | null {
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function dayIndex(d: Date): number {
  return Math.floor(d.getTime() / MS_DAY);
}

/** Absolute day gap; Infinity if either date is missing. */
function gapDays(a: Date | null, b: Date | null): number {
  if (!a || !b) return Infinity;
  return Math.abs(dayIndex(a) - dayIndex(b));
}

function popcount(n: number): number {
  let c = 0;
  while (n) { n &= n - 1; c++; }
  return c;
}

function lowerBound(arr: number[], target: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Find a subset of `items` (all positive, in cents) whose sum lands in
 *  [lo, hi], preferring the sum closest to `target`, then the largest
 *  subset. Returns indices into `items`, or null. Whole-group is tried
 *  first (the common case); a meet-in-the-middle search runs only when that
 *  misses and the pool is at most `cap` items. */
function findSubset(
  items: number[], lo: number, hi: number, target: number, cap = 18,
): number[] | null {
  const n = items.length;
  if (n === 0) return null;

  const total = items.reduce((a, b) => a + b, 0);
  if (total >= lo && total <= hi) return items.map((_, i) => i); // whole group
  if (n > cap) return null;                                      // too big to search

  const half = n >> 1;
  const left = items.slice(0, half);
  const right = items.slice(half);
  const lN = left.length, rN = right.length;

  const rEntries: { sum: number; mask: number }[] = [];
  for (let m = 0; m < (1 << rN); m++) {
    let s = 0;
    for (let i = 0; i < rN; i++) if (m & (1 << i)) s += right[i];
    rEntries.push({ sum: s, mask: m });
  }
  rEntries.sort((a, b) => a.sum - b.sum);
  const rSums = rEntries.map((e) => e.sum);

  let best: { diff: number; size: number; lmask: number; rmask: number } | null = null;
  for (let lm = 0; lm < (1 << lN); lm++) {
    let ls = 0, lsize = 0;
    for (let i = 0; i < lN; i++) if (lm & (1 << i)) { ls += left[i]; lsize++; }
    const needHi = hi - ls;
    if (needHi < 0) continue;
    const needLo = Math.max(lo - ls, 0);
    for (let k = lowerBound(rSums, needLo); k < rEntries.length && rEntries[k].sum <= needHi; k++) {
      const sum = ls + rEntries[k].sum;
      const diff = Math.abs(sum - target);
      const size = lsize + popcount(rEntries[k].mask);
      if (best === null || diff < best.diff || (diff === best.diff && size > best.size)) {
        best = { diff, size, lmask: lm, rmask: rEntries[k].mask };
      }
    }
  }
  if (!best) return null;

  const idxs: number[] = [];
  for (let i = 0; i < lN; i++) if (best.lmask & (1 << i)) idxs.push(i);
  for (let i = 0; i < rN; i++) if (best.rmask & (1 << i)) idxs.push(half + i);
  return idxs;
}

// ── group construction ──────────────────────────────────────────────────

function maxGap(bankDates: (Date | null)[], booksDates: (Date | null)[]): number {
  let g = 0;
  for (const a of bankDates) for (const b of booksDates) {
    const d = gapDays(a, b);
    if (isFinite(d) && d > g) g = d;
  }
  return g;
}

/** Description(s) for a group: every row's text in full, joined — so when
 *  several rows aggregate into one match the user sees all the names, not a
 *  "+N more" count. Duplicates are collapsed to keep it readable. */
function summarizeDesc(txns: { description: string }[]): string {
  const ds = txns.map((t) => t.description?.trim()).filter(Boolean);
  return [...new Set(ds)].join(" · ");
}

function earliest(dates: (Date | null)[]): Date | null {
  const valid = dates.filter((d): d is Date => d != null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

// ── reconcile ─────────────────────────────────────────────────────────────

export function reconcile(
  bank: BankTxn[],
  books: BooksTxn[],
  opts: ReconcileOptions = DEFAULT_OPTIONS,
  settlement: SettlementRow[] = [],
  cols: { bankColumns?: Record<string, string | null>; booksColumns?: Record<string, string | null> } = {},
): BankReconcileResult {
  const window = opts.dateWindowDays;
  const feeCeiling = opts.feeCeilingPct / 100;
  const tolCents = cents(opts.roundingToleranceRupees ?? 0); // 0 disables rounding match

  const bankByRow = new Map<number, BankTxn>(bank.map((t) => [t.row, t]));
  const booksByRow = new Map<number, BooksTxn>(books.map((t) => [t.row, t]));
  const usedBank = new Set<number>();
  const usedBooks = new Set<number>();

  const groups: MatchGroup[] = [];
  const notes: string[] = [];
  let gid = 0;

  function addGroup(
    method: MatchMethod, confidence: Confidence,
    bankRows: number[], booksRows: number[], note?: string,
  ) {
    const bankTxns = bankRows.map((r) => bankByRow.get(r)!);
    const booksTxns = booksRows.map((r) => booksByRow.get(r)!);
    const bankAmount = r2(bankTxns.reduce((a, t) => a + t.signed, 0));
    const booksAmount = r2(booksTxns.reduce((a, t) => a + t.signed, 0));
    const fee = r2(booksAmount - bankAmount);
    const gross = Math.abs(booksAmount) || Math.abs(bankAmount);
    const feeRatePct = fee !== 0 && gross !== 0 ? r2((fee / gross) * 100) : null;
    const dateGapDays = maxGap(bankTxns.map((t) => t.date), booksTxns.map((t) => t.date));
    groups.push({
      id: `g${++gid}`,
      method, confidence,
      bankRows, booksRows,
      bankAmount, booksAmount, fee, feeRatePct, dateGapDays,
      bankDate: ymd(earliest(bankTxns.map((t) => t.date))),
      booksDate: ymd(earliest(booksTxns.map((t) => t.date))),
      bankDesc: summarizeDesc(bankTxns),
      booksDesc: summarizeDesc(booksTxns),
      note,
    });
    bankRows.forEach((r) => usedBank.add(r));
    booksRows.forEach((r) => usedBooks.add(r));
  }

  const freeBank = () => bank.filter((t) => !usedBank.has(t.row));
  const freeBooks = () => books.filter((t) => !usedBooks.has(t.row));

  // Pair a single bank line with a single book line that is equal except for
  // sub-rupee paise rounding (the bank carries paise, the books are kept in
  // whole rupees). Runs only after the exact 1:1 passes, so an exact partner is
  // always preferred and never stolen. The gap (in ₹) is recorded in the note
  // and surfaces in the "Fee / diff" column so the user sees it is a round-off
  // match, not a clean tie. `wide` only changes the wording + confidence.
  function roundingWave(maxWindow: number, conf: Confidence, wide: boolean) {
    if (tolCents <= 0) return;
    const tolR = Math.ceil(tolCents / 100); // rupee-bucket scan radius
    const byRupee = new Map<number, BooksTxn[]>();
    for (const b of freeBooks()) {
      const k = Math.round(b.signed);
      (byRupee.get(k) ?? byRupee.set(k, []).get(k)!).push(b);
    }
    // largest amounts first so a big single line claims its near-equal partner
    const banks = freeBank().sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed) || a.row - b.row);
    for (const t of banks) {
      if (usedBank.has(t.row)) continue;
      const tc = cents(t.signed);
      if (!tc) continue;
      const base = Math.round(t.signed);
      let best: { b: BooksTxn; diff: number; gap: number } | null = null;
      for (let dr = -tolR; dr <= tolR; dr++) {
        const list = byRupee.get(base + dr);
        if (!list) continue;
        for (const b of list) {
          if (usedBooks.has(b.row) || Math.sign(b.signed) !== Math.sign(t.signed)) continue;
          const diff = Math.abs(cents(b.signed) - tc);
          if (diff === 0 || diff > tolCents) continue; // exact handled earlier
          const gap = gapDays(t.date, b.date);
          if (gap > maxWindow) continue;
          if (!best || diff < best.diff
            || (diff === best.diff && gap < best.gap)
            || (diff === best.diff && gap === best.gap && b.row < best.b.row)) {
            best = { b, diff, gap };
          }
        }
      }
      if (best) {
        const gapR = r2(best.diff / 100);
        const note = wide
          ? `round-off gap ₹${gapR}, wide-date (${best.gap}d)`
          : `round-off gap ₹${gapR}`;
        addGroup("rounding", conf, [t.row], [best.b.row], note);
      }
    }
  }

  // ── Pass 0: Razorpay settlement report ─────────────────────────────────
  for (const s of settlement) {
    const netC = cents(s.amount);
    const grossC = cents(s.amount + s.fee + s.tax);
    // bank credit equal to the net settlement, within the window of settledAt
    const bankCand = freeBank()
      .filter((t) => t.signed > 0 && cents(t.signed) === netC && gapDays(t.date, s.settledAt) <= window)
      .sort((a, b) => gapDays(a.date, s.settledAt) - gapDays(b.date, s.settledAt));
    if (!bankCand.length) continue;
    const bankRow = bankCand[0];
    // book inflows summing to the gross, within the window of settledAt
    const cand = freeBooks().filter((t) => t.signed > 0 && gapDays(t.date, s.settledAt) <= window);
    const idxs = findSubset(cand.map((t) => cents(t.signed)), grossC, grossC, grossC);
    if (!idxs) continue;
    addGroup(
      "settlement", "high",
      [bankRow.row], idxs.map((i) => cand[i].row),
      s.utr ? `Razorpay settlement ${s.utr}` : "Razorpay settlement",
    );
  }

  // ── Pass 1: exact 1:1 (same date, exact amount) ────────────────────────
  {
    const idx = new Map<string, number[]>();
    for (const b of freeBooks()) {
      const d = ymd(b.date);
      if (!d) continue;
      const key = `${d}|${cents(b.signed)}`;
      (idx.get(key) ?? idx.set(key, []).get(key)!).push(b.row);
    }
    for (const t of freeBank()) {
      const d = ymd(t.date);
      if (!d) continue;
      const q = idx.get(`${d}|${cents(t.signed)}`);
      if (q && q.length) addGroup("exact", "high", [t.row], [q.shift()!]);
    }
  }

  // ── Pass 2: date-tolerant 1:1 (exact amount, |gap| ≤ window) ────────────
  {
    const byAmt = new Map<number, BooksTxn[]>();
    for (const b of freeBooks()) {
      (byAmt.get(cents(b.signed)) ?? byAmt.set(cents(b.signed), []).get(cents(b.signed))!).push(b);
    }
    for (const t of freeBank()) {
      const list = byAmt.get(cents(t.signed));
      if (!list) continue;
      const cand = list
        .filter((b) => !usedBooks.has(b.row) && gapDays(t.date, b.date) <= window)
        .sort((a, b) => gapDays(t.date, a.date) - gapDays(t.date, b.date) || a.row - b.row);
      if (!cand.length) continue;
      const gap = gapDays(t.date, cand[0].date);
      addGroup("date-tolerant", gap <= 1 ? "high" : "medium", [t.row], [cand[0].row]);
    }
  }

  // ── Pass 2b: rounding 1:1 within window (paise dropped on the books side) ─
  // Before the group passes so a genuine large single line claims its near-equal
  // partner instead of being absorbed into a subset-sum.
  roundingWave(window, "medium", false);

  // ── Pass 3: reversals / refunds (equal-and-opposite pair on one side) ───
  type RevRow = { row: number; date: Date | null; description: string; signed: number };
  const usedRow = (side: "bank" | "books", row: number) =>
    side === "bank" ? usedBank.has(row) : usedBooks.has(row);
  function reversalPass(side: "bank" | "books", free: RevRow[]) {
    const buckets = new Map<number, { pos: RevRow[]; neg: RevRow[] }>();
    for (const t of free) {
      const k = Math.abs(cents(t.signed));
      if (!k) continue;
      const b = buckets.get(k) ?? buckets.set(k, { pos: [], neg: [] }).get(k)!;
      (t.signed > 0 ? b.pos : b.neg).push(t);
    }
    for (const { pos, neg } of buckets.values()) {
      pos.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
      neg.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
      let pi = 0;
      for (const n of neg) {
        if (usedRow(side, n.row)) continue;
        while (pi < pos.length && (usedRow(side, pos[pi].row) || gapDays(pos[pi].date, n.date) > window)) pi++;
        if (pi >= pos.length) break;
        const p = pos[pi];
        if (!looksLikeReversal(p.description) && !looksLikeReversal(n.description)) continue;
        if (side === "bank") addGroup("reversal", "medium", [p.row, n.row], [], "reversal / refund pair");
        else addGroup("reversal", "medium", [], [p.row, n.row], "reversal / refund pair");
        pi++;
      }
    }
  }
  reversalPass("bank", freeBank());
  reversalPass("books", freeBooks());

  // ── Pass 4: group-exact (N ↔ 1 summing exactly) ────────────────────────
  // 4a: many book rows → one bank line (UPI day-aggregation)
  for (const t of freeBank()) {
    const target = Math.abs(cents(t.signed));
    if (!target) continue;
    const cand = freeBooks().filter(
      (b) => Math.sign(b.signed) === Math.sign(t.signed) && gapDays(t.date, b.date) <= window,
    );
    const idxs = findSubset(cand.map((b) => Math.abs(cents(b.signed))), target, target, target);
    if (idxs && idxs.length >= 2) {
      const conf: Confidence = idxs.every((i) => gapDays(t.date, cand[i].date) === 0) ? "high" : "medium";
      const note = detectChannel(t.description) ? `${detectChannel(t.description)!.toUpperCase()} aggregation` : "grouped match";
      addGroup("group-exact", conf, [t.row], idxs.map((i) => cand[i].row), note);
    }
  }
  // 4b: many bank lines → one book row (one invoice paid in instalments)
  for (const b of freeBooks()) {
    const target = Math.abs(cents(b.signed));
    if (!target) continue;
    const cand = freeBank().filter(
      (t) => Math.sign(t.signed) === Math.sign(b.signed) && gapDays(b.date, t.date) <= window,
    );
    const idxs = findSubset(cand.map((t) => Math.abs(cents(t.signed))), target, target, target);
    if (idxs && idxs.length >= 2) {
      const conf: Confidence = idxs.every((i) => gapDays(b.date, cand[i].date) === 0) ? "high" : "medium";
      addGroup("group-exact", conf, idxs.map((i) => cand[i].row), [b.row], "split / instalment");
    }
  }

  // ── Pass 5: group-fee (gateway settlement, fee inferred) ────────────────
  for (const t of freeBank()) {
    if (t.signed <= 0 || !isGateway(t.description)) continue; // only gateway inflows
    const net = cents(t.signed);
    const lo = net;
    const hi = Math.floor(net / (1 - feeCeiling)); // gross ≤ net / (1 − ceiling)
    const cand = freeBooks().filter((b) => b.signed > 0 && gapDays(t.date, b.date) <= window);
    const idxs = findSubset(cand.map((b) => cents(b.signed)), lo, hi, lo);
    if (!idxs || !idxs.length) continue;
    const gross = idxs.reduce((a, i) => a + cents(cand[i].signed), 0);
    const pct = ((gross - net) / gross) * 100;
    addGroup(
      "group-fee", "medium",
      [t.row], idxs.map((i) => cand[i].row),
      `gateway settlement, fee ~${pct.toFixed(2)}%`,
    );
  }

  // ── Pass 5a-wide: wide-window exact 1:1 mop-up ─────────────────────────
  // Large single items the books and bank record the SAME but several days
  // apart — a loan EMI, a vendor RTGS, an inter-account transfer that did land
  // on this statement — fall outside the tolerant ±window and would otherwise
  // sit unmatched on BOTH sides (equal and opposite across the two ledgers),
  // bloating the exception totals even though they are the same money. We pair
  // them here by EXACT signed amount, nearest date, within a wider window —
  // crucially AFTER the group passes, so a row that belongs to a UPI/instalment
  // group is never stolen. Marked low confidence + a "wide-date" note so it is
  // visible for review (exact-amount-only keeps false pairs unlikely).
  {
    const WIDE = Math.max(window, 15);
    const idx = new Map<number, number[]>();
    for (const b of freeBooks()) {
      const k = cents(b.signed);
      (idx.get(k) ?? idx.set(k, []).get(k)!).push(b.row);
    }
    for (const t of freeBank()) {
      const q = idx.get(cents(t.signed));
      if (!q || !q.length) continue;
      let bestI = -1, bestD = Infinity;
      for (let i = 0; i < q.length; i++) {
        if (usedBooks.has(q[i])) continue;
        const dd = gapDays(t.date, booksByRow.get(q[i])!.date);
        if (dd <= WIDE && dd < bestD) { bestD = dd; bestI = i; }
      }
      if (bestI >= 0) addGroup("date-tolerant", "low", [t.row], [q[bestI]], `wide-date match (${bestD}d)`);
    }
  }

  // ── Pass 5a-rounding: rounding 1:1 over the wide window (mop-up) ────────
  // After the group passes (like the exact wide-date pass above) so a row that
  // belongs to a UPI/instalment group is never stolen. Low confidence.
  roundingWave(Math.max(window, 15), "low", true);

  // ── Pass 5b: contra / inter-account transfers that net to zero ─────────
  // Anything still unmatched that has an equal-and-opposite partner on the SAME
  // side never reached the bank on net: an own-account transfer booked out then
  // back in (e.g. to a/c …3122539), an FD placed then redeemed, or a provision
  // booked then reversed. Unlike Pass 3 these legs can be weeks apart and carry
  // no "reversal" wording, so we pair them here — after the group passes, so a
  // real UPI/instalment grouping is always preferred first — and label them a
  // net-zero contra (low confidence) so they leave the exception list instead
  // of showing as a scary large unmatched figure. netGap is unaffected (it is
  // computed from column totals, not from matches).
  function contraPass(side: "bank" | "books", free: RevRow[]) {
    const buckets = new Map<number, { pos: RevRow[]; neg: RevRow[] }>();
    for (const t of free) {
      const k = Math.abs(cents(t.signed));
      if (!k) continue;
      const b = buckets.get(k) ?? buckets.set(k, { pos: [], neg: [] }).get(k)!;
      (t.signed > 0 ? b.pos : b.neg).push(t);
    }
    for (const { pos, neg } of buckets.values()) {
      pos.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
      let pi = 0;
      for (const n of neg) {
        if (usedRow(side, n.row)) continue;
        while (pi < pos.length && usedRow(side, pos[pi].row)) pi++;
        if (pi >= pos.length) break;
        const p = pos[pi];
        const rows = [p.row, n.row];
        if (side === "bank") addGroup("contra", "low", rows, [], "contra / nets to zero (no bank line)");
        else addGroup("contra", "low", [], rows, "contra / nets to zero (no bank line)");
        pi++;
      }
    }
  }
  contraPass("books", freeBooks());
  contraPass("bank", freeBank());

  // ── Pass 6: classify the leftovers ─────────────────────────────────────
  const unmatchedBank: UnmatchedSide[] = freeBank().map((t) => ({
    row: t.row, file: t.file, fileRow: t.fileRow, date: ymd(t.date), description: t.description,
    debit: t.debit, credit: t.credit, signed: t.signed,
    hint: classifyUnmatched(t.description, t.debit, t.credit),
  }));
  const unmatchedBooks: UnmatchedSide[] = freeBooks().map((b) => ({
    row: b.row, file: b.file, fileRow: b.fileRow, date: ymd(b.date), description: b.description,
    debit: b.debit, credit: b.credit, signed: b.signed,
    hint: looksLikeReversal(b.description) ? "possible-reversal" : null,
  }));

  // ── Summary ─────────────────────────────────────────────────────────────
  const sumBy = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + f(x), 0);
  const byMethod = {
    exact: 0, "date-tolerant": 0, "group-exact": 0, "group-fee": 0, settlement: 0, reversal: 0, contra: 0, rounding: 0,
  } as Record<MatchMethod, number>;
  for (const g of groups) byMethod[g.method]++;

  const bankTotalDebits = r2(sumBy(bank, (t) => t.debit));
  const bankTotalCredits = r2(sumBy(bank, (t) => t.credit));
  const booksTotalDebits = r2(sumBy(books, (t) => t.debit));
  const booksTotalCredits = r2(sumBy(books, (t) => t.credit));
  const bankNet = r2(bankTotalCredits - bankTotalDebits);
  const booksNet = r2(booksTotalDebits - booksTotalCredits);

  const summary: ReconcileSummary = {
    bankTotalRows: bank.length,
    booksTotalRows: books.length,
    matchedGroups: groups.length,
    matchedBankRows: usedBank.size,
    matchedBooksRows: usedBooks.size,
    unmatchedBankCount: unmatchedBank.length,
    unmatchedBooksCount: unmatchedBooks.length,
    byMethod,
    bankTotalDebits, bankTotalCredits, booksTotalDebits, booksTotalCredits,
    bankNet, booksNet,
    netGap: r2(bankNet - booksNet),
    // only genuine gateway fee + GST — not the sub-rupee gap on a rounding match
    feesIdentified: r2(sumBy(groups.filter((g) => g.method === "settlement" || g.method === "group-fee"), (g) => g.fee)),
    bankChargesTotal: r2(sumBy(unmatchedBank.filter((u) => u.hint === "bank-charge"), (u) => u.debit)),
    interestTotal: r2(sumBy(unmatchedBank.filter((u) => u.hint === "interest"), (u) => u.credit)),
    tdsTotal: r2(sumBy(unmatchedBank.filter((u) => u.hint === "tds"), (u) => u.debit)),
  };

  return {
    summary,
    groups,
    unmatchedBank,
    unmatchedBooks,
    bankColumns: cols.bankColumns ?? {},
    booksColumns: cols.booksColumns ?? {},
    options: opts,
    notes,
  };
}
