/* Shared shapes for Bank Ledger Reconciliation.

   Two required sources, one optional:
     - bank statement  (the bank's export — date + description + debit +
       credit + balance)
     - books ledger    (the user's Tally / BC / Zoho export of the same
       bank account from their accounting system)
     - settlement report (optional Razorpay export — lets us reconcile a
       net settlement back to its gross payments + exact fee/GST)

   The bank statement and the books look at the same account from opposite
   sides, so we normalise to a SIGNED amount as seen from the user:
     bank.signed  = credit - debit   (positive = inflow)
     books.signed = debit  - credit  (positive = inflow)
   Equal signed amounts on both sides therefore represent the same money
   moving the same way.

   The matcher is multi-pass (see match.ts): a single bank line can map to
   many book rows (UPI day-aggregation) or vice versa (a customer paying one
   invoice in several instalments), so the result is expressed as GROUPS of
   rows rather than 1:1 pairs. */

export type BankTxn = {
  /** 1-indexed row number in the uploaded file, used for "see row N" hints. */
  row: number;
  date: Date | null;
  description: string;
  /** Money out of the customer's account (bank's debit on customer ledger). */
  debit: number;
  /** Money into the customer's account. */
  credit: number;
  /** Net signed amount: credit positive, debit negative. */
  signed: number;
  balance: number | null;
};

export type BooksTxn = {
  row: number;
  date: Date | null;
  description: string;
  /** Dr in the books = money received into the bank account (books-side). */
  debit: number;
  /** Cr in the books = money paid out. */
  credit: number;
  /** Net inflow: debit - credit. */
  signed: number;
  balance: number | null;
};

/** A parsed Razorpay (or similar gateway) settlement line. gross = amount + fee + tax. */
export type SettlementRow = {
  row: number;
  /** Bank UTR / settlement reference, surfaced in the matched group's note. */
  utr: string | null;
  settledAt: Date | null;
  /** Net amount actually credited to the bank. */
  amount: number;
  /** Gateway fee (excluding GST). */
  fee: number;
  /** GST charged on the fee. */
  tax: number;
};

export type MatchMethod =
  /** same date, exact amount, 1:1. */
  | "exact"
  /** equal amount, dates within the tolerance window, 1:1. */
  | "date-tolerant"
  /** N book rows ↔ 1 bank line (or vice versa) summing exactly — e.g. UPI. */
  | "group-exact"
  /** group sum minus a plausible gateway fee equals the bank line — Razorpay/POS. */
  | "group-fee"
  /** reconciled against an uploaded Razorpay settlement report (exact fee + GST). */
  | "settlement"
  /** an entry paired with its equal-and-opposite reversal/refund so both net out. */
  | "reversal";

export type Confidence = "high" | "medium" | "low";

export type MatchGroup = {
  /** Stable id ("g1", "g2", …) for keys + cross-references. */
  id: string;
  method: MatchMethod;
  confidence: Confidence;
  /** Bank-side rows in this group (often one). */
  bankRows: number[];
  /** Books-side rows in this group (often many). */
  booksRows: number[];
  /** Signed sum of the bank side. */
  bankAmount: number;
  /** Signed sum of the books side. */
  booksAmount: number;
  /** booksAmount − bankAmount: the gateway fee + GST swallowed in a settlement. 0 when exact. */
  fee: number;
  /** Implied fee as a % of the gross (books) amount; null when there is no fee. */
  feeRatePct: number | null;
  /** Largest date gap (days) between any bank and books row in the group. */
  dateGapDays: number;
  bankDate: string | null;
  booksDate: string | null;
  note?: string;
};

export type UnmatchedHint =
  | "bank-charge"
  | "interest"
  | "tds"
  | "possible-reversal"
  | null;

export type UnmatchedSide = {
  row: number;
  date: string | null;
  description: string;
  debit: number;
  credit: number;
  signed: number;
  /** Best-effort classification so the UI can pre-bucket exceptions. */
  hint: UnmatchedHint;
};

export type ReconcileSummary = {
  bankTotalRows: number;
  booksTotalRows: number;
  matchedGroups: number;
  matchedBankRows: number;
  matchedBooksRows: number;
  unmatchedBankCount: number;
  unmatchedBooksCount: number;
  /** Count of groups per match method. */
  byMethod: Record<MatchMethod, number>;
  bankTotalDebits: number;
  bankTotalCredits: number;
  booksTotalDebits: number;
  booksTotalCredits: number;
  bankNet: number;
  booksNet: number;
  /** bankNet − booksNet: the headline reconciliation gap. */
  netGap: number;
  /** Total gateway fees + GST identified across settlement / group-fee matches. */
  feesIdentified: number;
  /** Sum of unmatched bank debits flagged as bank charges. */
  bankChargesTotal: number;
  /** Sum of unmatched bank credits flagged as interest. */
  interestTotal: number;
  /** Sum of unmatched bank debits flagged as TDS. */
  tdsTotal: number;
};

export type ReconcileOptions = {
  /** Max day gap for date-tolerant + group matches. */
  dateWindowDays: number;
  /** Max inferred gateway fee as a % of gross, for the group-fee pass. */
  feeCeilingPct: number;
};

export const DEFAULT_OPTIONS: ReconcileOptions = {
  dateWindowDays: 3,
  feeCeilingPct: 3,
};

export type BankReconcileResult = {
  summary: ReconcileSummary;
  groups: MatchGroup[];
  unmatchedBank: UnmatchedSide[];
  unmatchedBooks: UnmatchedSide[];
  /** Detected column mappings, surfaced in the UI so the user can verify. */
  bankColumns: Record<string, string | null>;
  booksColumns: Record<string, string | null>;
  options: ReconcileOptions;
  /** Pipeline warnings (e.g. a day too large for subset search). */
  notes: string[];
};
