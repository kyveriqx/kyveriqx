/* ITC + sales reconciliation engine.

   Two parallel passes, one per "side" of the GST machine:

     1. ITC pass   — Purchase Register  ↔  GSTR-2B
                     "for every invoice we want ITC on, is the supplier's
                      filing visible to GSTN this period?"
     2. Sales pass — Sales Register     ↔  GSTR-1
                     "does what we told GSTN match what we told our books?"

   Both passes use the same invoice-level key: (partyGstin, normalisedInvoiceNo).
   Normalising strips punctuation and case, so "INV-001" / "INV/001" / "inv 001"
   all collide — that's almost always the desired behaviour, and we surface
   an `invoice-no-diff` warning when the raw strings differ so the user can
   still tell.

   Each books row consumes at most one portal row, so the leftover portal
   rows after both passes are real "missing in books" exceptions. Matched
   pairs go to `itcMatches` / `salesMatches`; mismatches go to the
   corresponding `*Exceptions` array tagged with the most severe diff.

   The supplier rollup (`SupplierRollup[]`) is computed at the end from the
   merged 2A / 2B / Purchase Register pools — it powers the "supplier filing
   status" tab. 2A − 2B is the "filed but past the cutoff" set; books − 2B
   is the "you've recorded but supplier hasn't filed yet" set. */

import type {
  GstInvoice, GstReconcileOptions, GstReconcileResult, GstReconcileSummary,
  ItcException, ItcExceptionKind, ItcMatch,
  SalesException, SalesMatch, SupplierRollup,
} from "./types";
import { DEFAULT_OPTIONS, normalizeInvoiceNo } from "./types";

// ── helpers ────────────────────────────────────────────────────────────

const MS_DAY = 86400000;

function gapDays(a: Date | null, b: Date | null): number {
  if (!a || !b) return Infinity;
  return Math.abs(
    Math.floor(a.getTime() / MS_DAY) - Math.floor(b.getTime() / MS_DAY),
  );
}

function ymd(d: Date | null): string | null {
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function paise(n: number): number {
  return Math.round(n * 100);
}

function key(gstin: string, invNo: string): string {
  return `${gstin}::${normalizeInvoiceNo(invNo)}`;
}

/** Sort severity for the exceptions list — higher = louder. Push the
 *  ITC-fully-at-risk rows (missing in 2B, supplier-typo) to the top of the
 *  table so the user sees the worst news first. */
const KIND_RANK: Record<ItcExceptionKind, number> = {
  "missing-in-2b": 6,
  "gstin-mismatch": 5,
  "missing-in-books": 4,
  "value-diff": 3,
  "tax-diff": 2,
  "date-diff": 1,
  "invoice-no-diff": 0,
};

// ── ITC pass: purchase register ↔ GSTR-2B ──────────────────────────────

function reconcileItc(
  purchase: GstInvoice[],
  twoB: GstInvoice[],
  opts: GstReconcileOptions,
): { matches: ItcMatch[]; exceptions: ItcException[] } {
  // (gstin, normalised invoice no) → first unconsumed 2B row.
  const byKey = new Map<string, GstInvoice>();
  // normalised invoice no → list of 2B rows (for gstin-mismatch detection).
  const byInvoiceNo = new Map<string, GstInvoice[]>();
  for (const inv of twoB) {
    const k = key(inv.partyGstin, inv.invoiceNo);
    if (!byKey.has(k)) byKey.set(k, inv);
    const nin = normalizeInvoiceNo(inv.invoiceNo);
    const list = byInvoiceNo.get(nin) ?? [];
    list.push(inv);
    byInvoiceNo.set(nin, list);
  }

  const consumed = new Set<number>(); // 2B row numbers already matched
  const matches: ItcMatch[] = [];
  const exceptions: ItcException[] = [];

  for (const books of purchase) {
    const k = key(books.partyGstin, books.invoiceNo);
    const candidate = byKey.get(k);

    if (candidate && !consumed.has(candidate.row)) {
      // Found the counterpart — classify any diffs.
      const dateGap = gapDays(books.invoiceDate, candidate.invoiceDate);
      const taxableDiff = paise(books.taxableValue) - paise(candidate.taxableValue);
      const taxDiff = paise(books.totalTax) - paise(candidate.totalTax);
      const tol = opts.amountTolerancePaise;
      const dateBad = dateGap > opts.dateWindowDays && isFinite(dateGap);
      const valueBad = Math.abs(taxableDiff) > tol;
      const taxBad = Math.abs(taxDiff) > tol;
      const invoiceNoDiff = books.invoiceNo !== candidate.invoiceNo;

      if (dateBad || valueBad || taxBad) {
        // It's a real exception — pick the most severe diff for the kind.
        let kind: ItcExceptionKind;
        const noteParts: string[] = [];
        if (valueBad) {
          kind = "value-diff";
          noteParts.push(`taxable diff ₹${(taxableDiff / 100).toFixed(2)}`);
        } else if (taxBad) {
          kind = "tax-diff";
          noteParts.push(`tax diff ₹${(taxDiff / 100).toFixed(2)}`);
        } else {
          kind = "date-diff";
          noteParts.push(`date gap ${dateGap}d (books ${ymd(books.invoiceDate)} vs 2B ${ymd(candidate.invoiceDate)})`);
        }
        if (valueBad && taxBad) noteParts.push(`tax diff ₹${(taxDiff / 100).toFixed(2)}`);
        if ((valueBad || taxBad) && dateBad) noteParts.push(`date gap ${dateGap}d`);
        if (invoiceNoDiff) noteParts.push(`invoice no "${books.invoiceNo}" vs "${candidate.invoiceNo}"`);

        consumed.add(candidate.row);
        exceptions.push({
          kind,
          books,
          twoB: candidate,
          note: noteParts.join(" · "),
          taxableAtRisk: Math.abs(taxableDiff) / 100,
          taxAtRisk: Math.abs(taxDiff) / 100,
        });
        continue;
      }

      // Clean (or only-soft-warning) match.
      consumed.add(candidate.row);
      const warnings: string[] = [];
      if (invoiceNoDiff) warnings.push(`invoice no normalised: "${books.invoiceNo}" ≈ "${candidate.invoiceNo}"`);
      if (dateGap > 0 && isFinite(dateGap)) warnings.push(`date gap ${dateGap}d (within window)`);
      matches.push({
        books,
        twoB: candidate,
        exact: warnings.length === 0,
        warnings,
      });
      continue;
    }

    // Same invoice number from a different supplier? Looks like a typo.
    const sameInv = byInvoiceNo.get(normalizeInvoiceNo(books.invoiceNo)) ?? [];
    const otherSupplier = sameInv.find((c) => c.partyGstin !== books.partyGstin && !consumed.has(c.row));
    if (otherSupplier) {
      consumed.add(otherSupplier.row);
      exceptions.push({
        kind: "gstin-mismatch",
        books,
        twoB: otherSupplier,
        note: `same invoice no but 2B GSTIN is ${otherSupplier.partyGstin} (books says ${books.partyGstin})`,
        taxableAtRisk: books.taxableValue,
        taxAtRisk: books.totalTax,
      });
      continue;
    }

    // No 2B counterpart at all — pure ITC at risk.
    exceptions.push({
      kind: "missing-in-2b",
      books,
      twoB: null,
      note: "no matching 2B row — supplier hasn't filed (or filed past the cutoff)",
      taxableAtRisk: books.taxableValue,
      taxAtRisk: books.totalTax,
    });
  }

  // Anything left in 2B that we never consumed = "missing in books".
  for (const inv of twoB) {
    if (consumed.has(inv.row)) continue;
    exceptions.push({
      kind: "missing-in-books",
      books: null,
      twoB: inv,
      note: "2B shows this invoice but it isn't in your purchase register",
      taxableAtRisk: inv.taxableValue,
      taxAtRisk: inv.totalTax,
    });
  }

  return { matches, exceptions };
}

// ── Sales pass: sales register ↔ GSTR-1 ────────────────────────────────

function reconcileSales(
  sales: GstInvoice[],
  gstr1: GstInvoice[],
  opts: GstReconcileOptions,
): { matches: SalesMatch[]; exceptions: SalesException[] } {
  const byKey = new Map<string, GstInvoice>();
  const byInvoiceNo = new Map<string, GstInvoice[]>();
  for (const inv of gstr1) {
    const k = key(inv.partyGstin, inv.invoiceNo);
    if (!byKey.has(k)) byKey.set(k, inv);
    const nin = normalizeInvoiceNo(inv.invoiceNo);
    const list = byInvoiceNo.get(nin) ?? [];
    list.push(inv);
    byInvoiceNo.set(nin, list);
  }

  const consumed = new Set<number>();
  const matches: SalesMatch[] = [];
  const exceptions: SalesException[] = [];

  for (const books of sales) {
    const k = key(books.partyGstin, books.invoiceNo);
    const candidate = byKey.get(k);
    if (candidate && !consumed.has(candidate.row)) {
      const dateGap = gapDays(books.invoiceDate, candidate.invoiceDate);
      const taxableDiff = paise(books.taxableValue) - paise(candidate.taxableValue);
      const taxDiff = paise(books.totalTax) - paise(candidate.totalTax);
      const tol = opts.amountTolerancePaise;
      const dateBad = dateGap > opts.dateWindowDays && isFinite(dateGap);
      const valueBad = Math.abs(taxableDiff) > tol;
      const taxBad = Math.abs(taxDiff) > tol;
      const invoiceNoDiff = books.invoiceNo !== candidate.invoiceNo;

      if (dateBad || valueBad || taxBad) {
        let kind: SalesException["kind"];
        if (valueBad) kind = "value-diff";
        else if (taxBad) kind = "tax-diff";
        else kind = "date-diff";
        consumed.add(candidate.row);
        exceptions.push({
          kind,
          books,
          gstr1: candidate,
          note: valueBad ? `taxable diff ₹${(taxableDiff / 100).toFixed(2)}`
            : taxBad ? `tax diff ₹${(taxDiff / 100).toFixed(2)}`
              : `date gap ${dateGap}d`,
          taxableAtRisk: Math.abs(taxableDiff) / 100,
          taxAtRisk: Math.abs(taxDiff) / 100,
        });
        continue;
      }

      consumed.add(candidate.row);
      const warnings: string[] = [];
      if (invoiceNoDiff) warnings.push(`invoice no normalised: "${books.invoiceNo}" ≈ "${candidate.invoiceNo}"`);
      if (dateGap > 0 && isFinite(dateGap)) warnings.push(`date gap ${dateGap}d (within window)`);
      matches.push({ books, gstr1: candidate, exact: warnings.length === 0, warnings });
      continue;
    }

    const sameInv = byInvoiceNo.get(normalizeInvoiceNo(books.invoiceNo)) ?? [];
    const otherCustomer = sameInv.find((c) => c.partyGstin !== books.partyGstin && !consumed.has(c.row));
    if (otherCustomer) {
      consumed.add(otherCustomer.row);
      exceptions.push({
        kind: "gstin-mismatch",
        books,
        gstr1: otherCustomer,
        note: `same invoice no but GSTR-1 customer GSTIN is ${otherCustomer.partyGstin}`,
        taxableAtRisk: books.taxableValue,
        taxAtRisk: books.totalTax,
      });
      continue;
    }

    exceptions.push({
      kind: "missing-in-gstr1",
      books,
      gstr1: null,
      note: "in sales register but not in GSTR-1 — risk of short-filing",
      taxableAtRisk: books.taxableValue,
      taxAtRisk: books.totalTax,
    });
  }

  for (const inv of gstr1) {
    if (consumed.has(inv.row)) continue;
    exceptions.push({
      kind: "missing-in-books",
      books: null,
      gstr1: inv,
      note: "GSTR-1 has this invoice but it isn't in your sales register",
      taxableAtRisk: inv.taxableValue,
      taxAtRisk: inv.totalTax,
    });
  }

  return { matches, exceptions };
}

// ── Supplier rollup ────────────────────────────────────────────────────

function buildSupplierRollup(
  purchase: GstInvoice[],
  twoA: GstInvoice[],
  twoB: GstInvoice[],
  itcMatches: ItcMatch[],
): SupplierRollup[] {
  type Agg = {
    name: string;
    booksCount: number; booksTaxable: number; booksTax: number;
    twoBCount: number; twoBTaxable: number; twoBTax: number;
    twoAKeys: Set<string>;
    twoBKeys: Set<string>;
    twoARows: GstInvoice[];
    matchedTax: number;
  };
  const map = new Map<string, Agg>();

  function get(gstin: string, name: string): Agg {
    let a = map.get(gstin);
    if (!a) {
      a = {
        name,
        booksCount: 0, booksTaxable: 0, booksTax: 0,
        twoBCount: 0, twoBTaxable: 0, twoBTax: 0,
        twoAKeys: new Set(), twoBKeys: new Set(), twoARows: [],
        matchedTax: 0,
      };
      map.set(gstin, a);
    }
    // Prefer the longest non-empty name we've seen.
    if (name && name.length > a.name.length) a.name = name;
    return a;
  }

  for (const inv of purchase) {
    if (!inv.partyGstin) continue;
    const a = get(inv.partyGstin, inv.partyName);
    a.booksCount += 1;
    a.booksTaxable += inv.taxableValue;
    a.booksTax += inv.totalTax;
  }
  for (const inv of twoB) {
    if (!inv.partyGstin) continue;
    const a = get(inv.partyGstin, inv.partyName);
    a.twoBCount += 1;
    a.twoBTaxable += inv.taxableValue;
    a.twoBTax += inv.totalTax;
    a.twoBKeys.add(normalizeInvoiceNo(inv.invoiceNo));
  }
  for (const inv of twoA) {
    if (!inv.partyGstin) continue;
    const a = get(inv.partyGstin, inv.partyName);
    a.twoAKeys.add(normalizeInvoiceNo(inv.invoiceNo));
    a.twoARows.push(inv);
  }
  for (const m of itcMatches) {
    const a = map.get(m.twoB.partyGstin);
    if (a) a.matchedTax += m.twoB.totalTax;
  }

  const rollups: SupplierRollup[] = [];
  for (const [gstin, a] of map) {
    let filedLateCount = 0;
    let filedLateTax = 0;
    for (const inv of a.twoARows) {
      const nin = normalizeInvoiceNo(inv.invoiceNo);
      if (!a.twoBKeys.has(nin)) {
        filedLateCount += 1;
        filedLateTax += inv.totalTax;
      }
    }
    rollups.push({
      gstin,
      name: a.name,
      booksInvoiceCount: a.booksCount,
      booksTaxableValue: round2(a.booksTaxable),
      booksTaxAmount: round2(a.booksTax),
      twoBInvoiceCount: a.twoBCount,
      twoBTaxableValue: round2(a.twoBTaxable),
      twoBTaxAmount: round2(a.twoBTax),
      filedLateInvoiceCount: filedLateCount,
      filedLateTaxAmount: round2(filedLateTax),
      taxAtRisk: round2(Math.max(0, a.booksTax - a.matchedTax)),
    });
  }
  // Highest tax-at-risk first — that's what the user wants to fix.
  rollups.sort((x, y) => y.taxAtRisk - x.taxAtRisk);
  return rollups;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Top-level entry ────────────────────────────────────────────────────

export function reconcileGst(input: {
  gstr1: GstInvoice[];
  gstr2a: GstInvoice[];
  gstr2b: GstInvoice[];
  sales: GstInvoice[];
  purchase: GstInvoice[];
  options?: Partial<GstReconcileOptions>;
}): Omit<GstReconcileResult, "sources" | "purchaseColumns" | "salesColumns" | "notes"> {
  const opts: GstReconcileOptions = { ...DEFAULT_OPTIONS, ...(input.options ?? {}) };

  const itc = reconcileItc(input.purchase, input.gstr2b, opts);
  const sales = reconcileSales(input.sales, input.gstr1, opts);
  const supplierRollup = buildSupplierRollup(
    input.purchase, input.gstr2a, input.gstr2b, itc.matches,
  );

  const itcExceptionsByKind: Record<ItcExceptionKind, number> = {
    "missing-in-2b": 0, "missing-in-books": 0, "gstin-mismatch": 0,
    "value-diff": 0, "tax-diff": 0, "date-diff": 0, "invoice-no-diff": 0,
  };
  for (const e of itc.exceptions) itcExceptionsByKind[e.kind] += 1;

  const salesExceptionsByKind: Record<SalesException["kind"], number> = {
    "missing-in-gstr1": 0, "missing-in-books": 0, "gstin-mismatch": 0,
    "value-diff": 0, "tax-diff": 0, "date-diff": 0, "invoice-no-diff": 0,
  };
  for (const e of sales.exceptions) salesExceptionsByKind[e.kind] += 1;

  const itcTaxableAtRisk = round2(itc.exceptions.reduce((a, e) => a + e.taxableAtRisk, 0));
  const itcTaxAtRisk = round2(itc.exceptions.reduce((a, e) => a + e.taxAtRisk, 0));
  const itcTaxMatched = round2(itc.matches.reduce((a, m) => a + m.twoB.totalTax, 0));
  const salesTaxableAtRisk = round2(sales.exceptions.reduce((a, e) => a + e.taxableAtRisk, 0));
  const salesTaxAtRisk = round2(sales.exceptions.reduce((a, e) => a + e.taxAtRisk, 0));

  const summary: GstReconcileSummary = {
    twoBInvoiceCount: input.gstr2b.length,
    twoAInvoiceCount: input.gstr2a.length,
    gstr1InvoiceCount: input.gstr1.length,
    purchaseInvoiceCount: input.purchase.length,
    salesInvoiceCount: input.sales.length,
    itcMatched: itc.matches.length,
    itcExceptionsByKind,
    itcTaxableAtRisk,
    itcTaxAtRisk,
    itcTaxMatched,
    salesMatched: sales.matches.length,
    salesExceptionsByKind,
    salesTaxableAtRisk,
    salesTaxAtRisk,
  };

  // Sort exceptions by severity desc, then by ₹ tax-at-risk desc — top of
  // the table is where the user should look first.
  itc.exceptions.sort((a, b) =>
    (KIND_RANK[b.kind] - KIND_RANK[a.kind]) || (b.taxAtRisk - a.taxAtRisk),
  );

  return {
    summary,
    itcMatches: itc.matches,
    itcExceptions: itc.exceptions,
    salesMatches: sales.matches,
    salesExceptions: sales.exceptions,
    supplierRollup,
    options: opts,
  };
}
