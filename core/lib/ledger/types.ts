/* Shared shapes for the Org Ledger Reconciliation engine.
   Mirrors the dict shapes the Python reference (reconcile.py / parse_ledger.py)
   returns, so a one-to-one diff against Python output is possible. */

export type DrCr = "Dr" | "Cr";

export type CompanyTxn = {
  sheet: string;
  date: Date | null;
  docType: string;
  docNo: string;
  /** Business partner's invoice number — the join key for invoice matching. */
  extNo: string;
  tds: number;
  debit: number;
  credit: number;
  balance: number;
  opening: number;
  closing: number;
};

export type CompanyLedger = {
  partyName: string;
  openingBal: number;
  /** Sign-adjusted: negative = company overpaid, positive = company owes partner. */
  closingBal: number;
  /** Raw closing magnitude (before sign adjustment). */
  closingRaw: number;
  closingDrCr: DrCr;
  transactions: CompanyTxn[];
  minDate: Date | null;
};

export type PartnerTxn = {
  location: string;
  date: Date | null;
  docType: string;
  docNo: string;
  amount: number;
  balance: number;
  /** Row description/narration — used to identify TDS adjustments. */
  desc?: string;
  /** Source filename this row came from (set when several files are merged). */
  source?: string;
  /** Financial-year tag, e.g. "FY23-24" (used when bridging multi-period data). */
  period?: string;
};

export type PartnerLocation = {
  location: string;
  partyName: string;
  openingBal: number;
  closingBal: number;
  transactions: PartnerTxn[];
  /** "excel" (Business Central / CSV) or "pdf" (Tally ledger). */
  format?: "excel" | "pdf";
  /** Closing balance printed in the source file — used as a parse control total. */
  printedClosing?: number;
  /** Closing recomputed from opening + transactions; should equal printedClosing. */
  computedClosing?: number;
  /** Source filenames contributing to this (possibly merged) location. */
  sources?: string[];
};

export type PartnerLedger = {
  locations: PartnerLocation[];
  totalClosing: number;
  /** Per-source parse warnings (control-total mismatches, bridge gaps, etc.). */
  notes?: string[];
};

export type MatchStatus = "Matched" | "TDS Diff" | "Amount Mismatch";

export type MatchedInvoice = {
  location: string;
  invoiceNo: string;
  partnerDate: Date | null;
  partnerAmount: number;
  companyRef: string;
  companyDate: Date | null;
  companyAmount: number;
  tdsDeducted: number;
  amountDiff: number;
  netDiff: number;
  docType: string;
  status: MatchStatus;
  /** How the pair was found: "docno" (invoice number) or "amount-date" (the two
   *  ERPs number invoices differently, so a fallback paired them by value+date). */
  matchBy?: "docno" | "amount-date";
};

export type MatchedPayment = {
  location: string;
  companyRef: string;
  companyDate: Date | null;
  amount: number;
  partnerRef: string;
  partnerDate: Date | null;
  status: "Matched";
  /** >1 when one company payment was matched to several split partner receipts. */
  count?: number;
};

/** A transaction that exists in one book but falls outside the OTHER book's date
 *  coverage — a cut-off/timing difference, not a real disagreement. */
export type CutoffItem = {
  side: "company" | "partner";
  location: string;
  ref: string;
  date: Date | null;
  amount: number;
};

/** Plain-language breakdown of WHY the two closings differ. */
export type GapAnalysis = {
  totalGap: number;
  tdsCompanyDeducted: number;
  tdsPartnerCredited: number;
  tdsNet: number;
  cutoffItems: CutoffItem[];
  cutoffTotal: number;
  companyLastDate: Date | null;
  partnerLastDate: Date | null;
  matchedInvoiceCount: number;
  amountDateMatchedCount: number;
};

export type UnmatchedCompanyInvoice = {
  sheet: string;
  date: Date | null;
  docType: string;
  docNo: string;
  extNo: string;
  tds: number;
  debit: number;
  credit: number;
  reason: string;
};

export type UnmatchedPartnerInvoice = {
  location: string;
  date: Date | null;
  docType: string;
  docNo: string;
  amount: number;
  reason: string;
};

export type UnmatchedCompanyPayment = {
  companyRef: string;
  date: Date | null;
  amount: number;
  reason: string;
};

export type LocationSummary = {
  location: string;
  openingBal: number;
  closingBal: number;
  matchedInv: number;
  status: "Settled" | "Outstanding";
};

export type ReconcileResult = {
  // Balances
  companyClosing: number;
  partnerClosing: number;
  totalGap: number;
  companySignLabel: string;
  partnerSignLabel: string;
  // Matched
  matchedInvoices: MatchedInvoice[];
  matchedPayments: MatchedPayment[];
  // Gaps
  unmatchedCompanyInv: UnmatchedCompanyInvoice[];
  unmatchedPartnerInv: UnmatchedPartnerInvoice[];
  unmatchedCompanyPay: UnmatchedCompanyPayment[];
  // Summaries
  locationSummary: LocationSummary[];
  totalTds: number;
  companyPartyName: string;
  /** Why the two books differ (TDS net, cut-off/timing, match coverage). */
  gapAnalysis?: GapAnalysis;
};

export type ReconcileOptions = {
  fromDate?: Date | string | null;
  toDate?: Date | string | null;
  /** Date tolerance (days) for payment matching. Default 7. */
  paymentWindowDays?: number;
  /** Date tolerance (days) for the invoice amount+date fallback. Default 45. */
  invoiceWindowDays?: number;
};
