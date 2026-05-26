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
};

export type PartnerLocation = {
  location: string;
  partyName: string;
  openingBal: number;
  closingBal: number;
  transactions: PartnerTxn[];
};

export type PartnerLedger = {
  locations: PartnerLocation[];
  totalClosing: number;
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
};

export type MatchedPayment = {
  location: string;
  companyRef: string;
  companyDate: Date | null;
  amount: number;
  partnerRef: string;
  partnerDate: Date | null;
  status: "Matched";
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
};

export type ReconcileOptions = {
  fromDate?: Date | string | null;
  toDate?: Date | string | null;
};
