/* Shared shapes for GST Ledger Reconciliation.

   Inputs (each side may be one or many files):
     - GSTR-2B      portal JSON / XLSX — the supplier-filed snapshot that
                    defines the customer's eligible ITC for the period.
     - GSTR-2A      portal JSON / XLSX — dynamic supplier filings; used
                    only for the supplier-rollup tab to show "filed but
                    past the 2B cutoff".
     - GSTR-1       portal JSON / XLSX — the customer's own outward
                    supplies, for the sales-side reco tab.
     - Purchase     ERP CSV / XLSX     — the customer's books of inward
       Register                          supplies (the ITC they intend to
                                         claim).
     - Sales        ERP CSV / XLSX     — the customer's books of outward
       Register                          supplies (to compare with their
                                         own filed GSTR-1).

   Everything is normalised down to GstInvoice rows. The portal exports
   carry a richer structure (per-item HSN, rate, place of supply) — v1
   collapses to invoice-level totals on purpose: that's the granularity
   at which ITC is allowed and the granularity at which Indian books
   actually book the entry. HSN/rate matching is a v2 problem. */

export type GstReturn =
  | "gstr1"      // outward (sales) — user's filed
  | "gstr2a"     // inward (purchases) — dynamic supplier view
  | "gstr2b"     // inward (purchases) — static, defines ITC eligibility
  | "sales"      // user's books of outward supply
  | "purchase";  // user's books of inward supply

/** A single normalised invoice row. The same shape carries both portal
 *  rows and books rows; `source` tells you which side it came from. */
export type GstInvoice = {
  /** Globally unique row number across merged files on this side. */
  row: number;
  /** Source filename (or "<portal-json>" for JSON exports). */
  file: string;
  /** 1-indexed row within the source file (for "see <file> row N" hints). */
  fileRow: number;
  /** Which input slot this row came from. */
  source: GstReturn;

  /** Counter-party GSTIN. For 2A/2B/purchase this is the supplier; for
   *  1/sales this is the customer. Normalised to uppercase, trimmed. */
  partyGstin: string;
  /** Counter-party trade name when the portal exposes it. */
  partyName: string;

  /** Invoice number as written. Matching uses a normalised form (see
   *  normalizeInvoiceNo). */
  invoiceNo: string;
  invoiceDate: Date | null;

  /** Sum of taxable values on the invoice (₹, two-decimal). */
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** igst + cgst + sgst + cess. */
  totalTax: number;
  /** Total invoice value including tax (as reported by the portal or
   *  derived from taxable + totalTax). */
  invoiceValue: number;

  /** GSTR-2B only: portal-asserted ITC eligibility for the period.
   *  null when the source doesn't say (every other input slot). */
  itcEligible: boolean | null;
  /** GSTR-2B only: ineligibility reason if itcEligible === false. */
  itcReason: string | null;

  /** GSTR-2B / 2A only: the date the supplier actually filed the return
   *  carrying this invoice (drives the "filed late" rollup). */
  filedAt: Date | null;
};

/** One uploaded file's contribution to a merged side. */
export type FileSource = {
  file: string;
  rows: number;
  rowStart: number;
  rowEnd: number;
};

/** Why a purchase-register row failed to match a 2B row. */
export type ItcExceptionKind =
  /** Books has the invoice; 2B does not. Supplier hasn't filed (or filed
   *  past the cutoff). Plain ITC at risk. */
  | "missing-in-2b"
  /** 2B has the invoice; books does not. Either an unrecorded purchase or
   *  a supplier mis-filing — usually a duplicate / wrong GSTIN. */
  | "missing-in-books"
  /** Same invoice number found but the supplier GSTINs don't match. */
  | "gstin-mismatch"
  /** Matched on GSTIN + invoice no, but taxable value differs > tolerance. */
  | "value-diff"
  /** Matched on GSTIN + invoice no, but tax amount differs > tolerance. */
  | "tax-diff"
  /** Matched on GSTIN + invoice no, but invoice date differs > window. */
  | "date-diff"
  /** Matched on GSTIN, normalised invoice numbers agree but the raw
   *  invoice strings differ (e.g. "INV-001" vs "INV/001"). Informational. */
  | "invoice-no-diff";

export type ItcException = {
  kind: ItcExceptionKind;
  /** The purchase-register row (or 2B row for "missing-in-books"). */
  books: GstInvoice | null;
  /** The 2B counterpart, when one was found at all. */
  twoB: GstInvoice | null;
  /** Human-readable description of the discrepancy. */
  note: string;
  /** ₹ taxable value at risk on this exception (always positive). */
  taxableAtRisk: number;
  /** ₹ tax credit at risk on this exception (always positive). */
  taxAtRisk: number;
};

/** A successful invoice-level match between books (purchase register)
 *  and the 2B snapshot. */
export type ItcMatch = {
  books: GstInvoice;
  twoB: GstInvoice;
  /** True iff every field tied out within tolerance (no soft warnings). */
  exact: boolean;
  /** Soft-warning notes when exact === false but we still consider it a
   *  match (e.g. invoice-no normalised, date within window). */
  warnings: string[];
};

/** Per-supplier rollup, surfaced as Tab 3. Aggregates 2A vs 2B so the
 *  customer can pressure suppliers who filed late or didn't file at all. */
export type SupplierRollup = {
  gstin: string;
  name: string;
  /** Invoices the user has in their purchase register from this supplier. */
  booksInvoiceCount: number;
  booksTaxableValue: number;
  booksTaxAmount: number;
  /** Invoices from this supplier visible in 2B (eligible ITC). */
  twoBInvoiceCount: number;
  twoBTaxableValue: number;
  twoBTaxAmount: number;
  /** Invoices in 2A from this supplier but NOT in 2B — filed past cutoff. */
  filedLateInvoiceCount: number;
  filedLateTaxAmount: number;
  /** ₹ ITC at risk from this supplier (books minus 2B match value, ≥ 0). */
  taxAtRisk: number;
};

/** One pairing in the sales-side reco (GSTR-1 vs Sales Register). */
export type SalesMatch = {
  books: GstInvoice;
  gstr1: GstInvoice;
  exact: boolean;
  warnings: string[];
};

export type SalesException = {
  kind: "missing-in-gstr1" | "missing-in-books" | "value-diff" | "tax-diff" | "date-diff" | "invoice-no-diff" | "gstin-mismatch";
  books: GstInvoice | null;
  gstr1: GstInvoice | null;
  note: string;
  taxableAtRisk: number;
  taxAtRisk: number;
};

export type GstReconcileOptions = {
  /** Max day gap permitted for date-tolerant matches before we flag
   *  date-diff. Default 7 — a week covers most "invoice in March, filed
   *  early April" cases without masking a real mismatch. */
  dateWindowDays: number;
  /** Tolerance for ₹ comparisons, in paise (i.e. 100 = ₹1). Default 100. */
  amountTolerancePaise: number;
};

export const DEFAULT_OPTIONS: GstReconcileOptions = {
  dateWindowDays: 7,
  amountTolerancePaise: 100,
};

export type GstReconcileSummary = {
  /** Row counts after merge. */
  twoBInvoiceCount: number;
  twoAInvoiceCount: number;
  gstr1InvoiceCount: number;
  purchaseInvoiceCount: number;
  salesInvoiceCount: number;

  /** ITC-side counts (books ↔ 2B). */
  itcMatched: number;
  itcExceptionsByKind: Record<ItcExceptionKind, number>;
  /** ₹ taxable value of every exception added up (the headline KPI). */
  itcTaxableAtRisk: number;
  /** ₹ tax credit at stake (the second headline KPI). */
  itcTaxAtRisk: number;
  /** ₹ tax credit safely matched (good news number). */
  itcTaxMatched: number;

  /** Sales-side counts (sales register ↔ GSTR-1). */
  salesMatched: number;
  salesExceptionsByKind: Record<SalesException["kind"], number>;
  salesTaxableAtRisk: number;
  salesTaxAtRisk: number;
};

export type GstReconcileResult = {
  summary: GstReconcileSummary;
  itcMatches: ItcMatch[];
  itcExceptions: ItcException[];
  salesMatches: SalesMatch[];
  salesExceptions: SalesException[];
  supplierRollup: SupplierRollup[];
  options: GstReconcileOptions;
  /** Pipeline warnings (e.g. "GSTR-2B JSON missing docdata.b2b"). */
  notes: string[];
  /** Per-side file legend, mirrors bankledgerreco.sources shape. */
  sources: {
    gstr1: FileSource[];
    gstr2a: FileSource[];
    gstr2b: FileSource[];
    sales: FileSource[];
    purchase: FileSource[];
  };
  /** Auto-detected column mapping for the register parsers, surfaced in
   *  the UI so the user can verify what we read. */
  purchaseColumns: Record<string, string | null>;
  salesColumns: Record<string, string | null>;
};

/** Normalise an invoice number for matching: uppercase, strip every
 *  non-alphanumeric character. "INV-001" ≡ "INV/001" ≡ "INV 001". The
 *  original string is preserved on the row so the UI can still display
 *  the supplier's actual numbering. */
export function normalizeInvoiceNo(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Normalise a GSTIN: uppercase, trim, strip whitespace. Doesn't
 *  validate the 15-char checksum — invalid GSTINs surface as gstin
 *  mismatches anyway, and a strict validator here would drop rows that
 *  the user wants to see flagged. */
export function normalizeGstin(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "").trim();
}
