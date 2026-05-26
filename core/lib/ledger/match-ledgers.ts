/* Matching engine — direct port of reconcile() in reconcile.py.

   Matches Your Company's invoices/payments against Your Business Partner's
   (potentially multi-location) book, classifies each match, surfaces gaps,
   and computes the sign-aware closing balance comparison. */

import type {
  CompanyLedger,
  LocationSummary,
  MatchedInvoice,
  MatchedPayment,
  MatchStatus,
  PartnerLedger,
  PartnerTxn,
  ReconcileOptions,
  ReconcileResult,
  UnmatchedCompanyInvoice,
  UnmatchedCompanyPayment,
  UnmatchedPartnerInvoice,
} from "./types";

const INVOICE_DOC_TYPES = new Set(["Invoice", "Credit Memo"]);
const PAYMENT_COMPANY_DOC_TYPES = new Set(["Payment", "", " "]);

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.floor((a.getTime() - b.getTime()) / 86_400_000));
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

export function reconcile(
  company: CompanyLedger,
  partner: PartnerLedger,
  opts: ReconcileOptions = {},
): ReconcileResult {
  // 0. Period filter — drop company txns before partner's earliest date
  //    (plus optional from/to clamps).
  let partnerStart: Date | null = null;
  for (const loc of partner.locations) {
    for (const t of loc.transactions) {
      if (t.date && (!partnerStart || t.date < partnerStart)) partnerStart = t.date;
    }
  }
  const fromDate = toDate(opts.fromDate);
  const toDateClamp = toDate(opts.toDate);

  const inWindow = (d: Date | null) => {
    if (d == null) return true; // null dates always pass (Python pandas behaviour)
    if (partnerStart && d < partnerStart) return false;
    if (fromDate && d < fromDate) return false;
    if (toDateClamp && d > toDateClamp) return false;
    return true;
  };

  const companyTxns = company.transactions.filter((t) => inWindow(t.date));

  // 1. Build partner invoice master + payment master across all locations.
  type PInv = PartnerTxn & { _idx: number };
  const partnerInvoices: PInv[] = [];
  const partnerPayments: PInv[] = [];
  let pidx = 0;
  for (const loc of partner.locations) {
    for (const t of loc.transactions) {
      if (INVOICE_DOC_TYPES.has(t.docType)) {
        partnerInvoices.push({ ...t, _idx: pidx++ });
      } else if (t.amount !== 0) {
        partnerPayments.push({ ...t, _idx: pidx++ });
      }
    }
  }

  // 2. Split company transactions.
  const companyInv = companyTxns.filter((t) => INVOICE_DOC_TYPES.has(t.docType.trim()));
  const companyPay = companyTxns.filter(
    (t) => PAYMENT_COMPANY_DOC_TYPES.has(t.docType.trim()) && t.debit > 0,
  );

  // 3. Match invoices on partner invoice number (case-insensitive, trimmed).
  //    Fallback: partial match on segment after last "/".
  const matchedInvoices: MatchedInvoice[] = [];
  const unmatchedCompanyInv: UnmatchedCompanyInvoice[] = [];
  const matchedPartnerIdx = new Set<number>();

  // Pre-index partner invoices by normalised doc_no for O(1) primary lookup.
  const partnerByDocNo = new Map<string, PInv[]>();
  for (const p of partnerInvoices) {
    const key = p.docNo.toUpperCase().trim();
    const bucket = partnerByDocNo.get(key);
    if (bucket) bucket.push(p);
    else partnerByDocNo.set(key, [p]);
  }

  for (const g of companyInv) {
    const ext = g.extNo.trim().toUpperCase();
    if (!ext) {
      unmatchedCompanyInv.push({
        sheet: g.sheet,
        date: g.date,
        docType: g.docType,
        docNo: g.docNo,
        extNo: g.extNo,
        tds: g.tds,
        debit: g.debit,
        credit: g.credit,
        reason: "No external reference number",
      });
      continue;
    }

    // Primary: exact (normalised) match. Python (reconcile.py) does not exclude
    // already-matched partner rows from the primary lookup — it just takes the
    // first hit in the mask. Preserve that for bit-comparable output, even
    // though it can theoretically double-match the same partner invoice when
    // two company invoices share an ext_no.
    let hits = partnerByDocNo.get(ext) ?? [];

    // Fallback: partial match on segment after the last "/".
    if (hits.length === 0) {
      const short = ext.includes("/") ? ext.substring(ext.lastIndexOf("/") + 1) : ext;
      if (short) {
        hits = partnerInvoices.filter((p) => p.docNo.toUpperCase().includes(short));
      }
    }

    if (hits.length === 0) {
      unmatchedCompanyInv.push({
        sheet: g.sheet,
        date: g.date,
        docType: g.docType,
        docNo: g.docNo,
        extNo: g.extNo,
        tds: g.tds,
        debit: g.debit,
        credit: g.credit,
        reason: `Invoice '${ext}' not found in Business Partner's books`,
      });
      continue;
    }

    const p = hits[0];
    matchedPartnerIdx.add(p._idx);

    const companyAmt = g.credit;
    const partnerAmt = Math.abs(p.amount);
    const tdsDiff = r2(partnerAmt - companyAmt);
    const netDiff = r2(partnerAmt - companyAmt - g.tds);

    let status: MatchStatus;
    if (Math.abs(netDiff) < 5 && tdsDiff > 0) status = "TDS Diff";
    else if (Math.abs(tdsDiff) < 2) status = "Matched";
    else status = "Amount Mismatch";

    matchedInvoices.push({
      location: p.location,
      invoiceNo: ext,
      partnerDate: p.date,
      partnerAmount: partnerAmt,
      companyRef: g.docNo,
      companyDate: g.date,
      companyAmount: companyAmt,
      tdsDeducted: g.tds,
      amountDiff: tdsDiff,
      netDiff,
      docType: g.docType,
      status,
    });
  }

  // 4. Partner invoices with no company counterpart.
  const unmatchedPartnerInv: UnmatchedPartnerInvoice[] = [];
  for (const p of partnerInvoices) {
    if (matchedPartnerIdx.has(p._idx)) continue;
    unmatchedPartnerInv.push({
      location: p.location,
      date: p.date,
      docType: p.docType,
      docNo: p.docNo,
      amount: p.amount,
      reason: `Invoice '${p.docNo}' not found in Your Company's books`,
    });
  }

  // 5. Match payments — exact amount (rounded 2dp) + date within ±5 days.
  const matchedPayments: MatchedPayment[] = [];
  const unmatchedCompanyPay: UnmatchedCompanyPayment[] = [];
  const matchedPartnerPayIdx = new Set<number>();

  for (const g of companyPay) {
    const companyAmt = r2(g.debit);
    const companyDt = g.date;
    let hit: PInv | null = null;

    if (companyDt) {
      for (const p of partnerPayments) {
        if (matchedPartnerPayIdx.has(p._idx)) continue;
        if (r2(Math.abs(p.amount)) !== companyAmt) continue;
        if (!p.date) continue;
        if (daysBetween(p.date, companyDt) > 5) continue;
        hit = p;
        break;
      }
    }

    if (hit) {
      matchedPartnerPayIdx.add(hit._idx);
      matchedPayments.push({
        location: hit.location,
        companyRef: g.docNo,
        companyDate: companyDt,
        amount: companyAmt,
        partnerRef: hit.docNo,
        partnerDate: hit.date,
        status: "Matched",
      });
    } else {
      unmatchedCompanyPay.push({
        companyRef: g.docNo,
        date: companyDt,
        amount: companyAmt,
        reason: "Payment not found in Business Partner's books",
      });
    }
  }

  // 6. Closing balances + sign labels.
  // company.closingBal: negative = company overpaid; positive = company owes partner.
  // partner.totalClosing: positive = company owes partner; negative = partner owes company.
  const companyClosing = company.closingBal;
  const partnerClosing = partner.totalClosing;

  const companySignLabel =
    companyClosing < 0
      ? `Business Partner owes YOU ₹${Math.abs(companyClosing).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (you overpaid)`
      : companyClosing > 0
      ? `You owe Business Partner ₹${companyClosing.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "ZERO — fully settled";

  const partnerSignLabel =
    partnerClosing > 0
      ? `YOU owe Business Partner ₹${partnerClosing.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : partnerClosing < 0
      ? `Business Partner owes YOU ₹${Math.abs(partnerClosing).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "ZERO — fully settled";

  // Opposite-direction case: books disagree about who owes whom → sum absolute values.
  const oppositeDirections =
    (companyClosing < 0 && partnerClosing > 0) ||
    (companyClosing > 0 && partnerClosing < 0);
  const totalGap = oppositeDirections
    ? Math.abs(companyClosing) + Math.abs(partnerClosing)
    : Math.abs(partnerClosing - companyClosing);

  // 7. Per-location summary.
  const locationSummary: LocationSummary[] = partner.locations.map((loc) => {
    const invCount = matchedInvoices.filter((m) => m.location === loc.location).length;
    return {
      location: loc.location,
      openingBal: loc.openingBal,
      closingBal: loc.closingBal,
      matchedInv: invCount,
      status: Math.abs(loc.closingBal) < 1 ? "Settled" : "Outstanding",
    };
  });

  // 8. TDS summary.
  const totalTds = matchedInvoices.reduce((s, m) => s + m.tdsDeducted, 0);

  return {
    companyClosing,
    partnerClosing,
    totalGap,
    companySignLabel,
    partnerSignLabel,
    matchedInvoices,
    matchedPayments,
    unmatchedCompanyInv,
    unmatchedPartnerInv,
    unmatchedCompanyPay,
    locationSummary,
    totalTds,
    companyPartyName: company.partyName || "Business Partner",
  };
}
