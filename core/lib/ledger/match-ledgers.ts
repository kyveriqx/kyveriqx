/* Matching engine — ported & extended from reconcile.py.

   Matches the company's invoices/payments against the partner's (multi-location)
   book and classifies every line. Beyond the original document-number join it
   now adds the pieces the live tool was missing for real cross-ERP data:
     - an amount+date invoice fallback (the two systems number invoices
       differently, and the company books invoices net-of-TDS while the partner
       books them gross),
     - split-payment matching (one company lump = several partner receipts),
     - cut-off/timing classification (a row outside the OTHER book's date range
       is a timing difference, not a disagreement), and
     - a gap analysis that quantifies the TDS net and the cut-off total. */

import type {
  CompanyLedger,
  CompanyTxn,
  CutoffItem,
  GapAnalysis,
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

/** Is this transaction a TDS adjustment in the partner's book? Detected from the
 *  description ("TDS Receivable", "TDS REC."), not the voucher prefix — journal
 *  vouchers (P-JLV…) are also used for non-TDS reversals. */
function isPartnerTds(t: PartnerTxn): boolean {
  return /\btds\b/i.test(`${t.desc ?? ""} ${t.docNo}`);
}

export function reconcile(
  company: CompanyLedger,
  partner: PartnerLedger,
  opts: ReconcileOptions = {},
): ReconcileResult {
  const paymentWindow = opts.paymentWindowDays ?? 7;
  const invoiceWindow = opts.invoiceWindowDays ?? 45;

  // 0. Period filter — drop company txns before the partner's earliest date.
  let partnerStart: Date | null = null;
  let partnerLast: Date | null = null;
  for (const loc of partner.locations) {
    for (const t of loc.transactions) {
      if (t.date) {
        if (!partnerStart || t.date < partnerStart) partnerStart = t.date;
        if (!partnerLast || t.date > partnerLast) partnerLast = t.date;
      }
    }
  }
  const fromDate = toDate(opts.fromDate);
  const toDateClamp = toDate(opts.toDate);
  const inWindow = (d: Date | null) => {
    if (d == null) return true;
    if (partnerStart && d < partnerStart) return false;
    if (fromDate && d < fromDate) return false;
    if (toDateClamp && d > toDateClamp) return false;
    return true;
  };
  const companyTxns = company.transactions.filter((t) => inWindow(t.date));
  let companyLast: Date | null = null;
  for (const t of companyTxns) if (t.date && (!companyLast || t.date > companyLast)) companyLast = t.date;

  // 1. Partner invoice + payment masters across all locations.
  type PInv = PartnerTxn & { _idx: number };
  const partnerInvoices: PInv[] = [];
  const partnerPayments: PInv[] = [];
  let pidx = 0;
  for (const loc of partner.locations) {
    for (const t of loc.transactions) {
      if (INVOICE_DOC_TYPES.has(t.docType)) partnerInvoices.push({ ...t, _idx: pidx++ });
      else if (t.amount !== 0) partnerPayments.push({ ...t, _idx: pidx++ });
    }
  }

  // 2. Split company transactions.
  const companyInv = companyTxns.filter((t) => INVOICE_DOC_TYPES.has(t.docType.trim()));
  const companyPay = companyTxns.filter(
    (t) => PAYMENT_COMPANY_DOC_TYPES.has(t.docType.trim()) && t.debit > 0,
  );

  const matchedInvoices: MatchedInvoice[] = [];
  const matchedPartnerIdx = new Set<number>();
  const companyInvLeft: CompanyTxn[] = [];

  // company invoice signed amount (Invoice +, Credit Memo −) in partner terms.
  const companySigned = (g: CompanyTxn) => r2(g.credit - g.debit);

  function classify(companyAmt: number, partnerAmt: number, tds: number): MatchStatus {
    const tdsDiff = r2(partnerAmt - companyAmt);
    const netDiff = r2(partnerAmt - companyAmt - tds);
    if (Math.abs(netDiff) < 5 && tdsDiff > 0) return "TDS Diff";
    if (Math.abs(tdsDiff) < 2) return "Matched";
    return "Amount Mismatch";
  }

  function pushMatch(g: CompanyTxn, p: PInv, by: "docno" | "amount-date") {
    matchedPartnerIdx.add(p._idx);
    const companyAmt = g.credit > 0 ? g.credit : g.debit;
    const partnerAmt = Math.abs(p.amount);
    matchedInvoices.push({
      location: p.location,
      invoiceNo: g.extNo || p.docNo,
      partnerDate: p.date,
      partnerAmount: partnerAmt,
      companyRef: g.docNo,
      companyDate: g.date,
      companyAmount: companyAmt,
      tdsDeducted: g.tds,
      amountDiff: r2(partnerAmt - companyAmt),
      netDiff: r2(partnerAmt - companyAmt - g.tds),
      docType: g.docType,
      status: classify(companyAmt, partnerAmt, g.tds),
      matchBy: by,
    });
  }

  // 3a. Invoice match — primary: partner invoice number (exact, then segment).
  const partnerByDocNo = new Map<string, PInv[]>();
  for (const p of partnerInvoices) {
    const key = p.docNo.toUpperCase().trim();
    (partnerByDocNo.get(key) ?? partnerByDocNo.set(key, []).get(key)!).push(p);
  }
  for (const g of companyInv) {
    const ext = g.extNo.trim().toUpperCase();
    let hit: PInv | undefined;
    if (ext) {
      hit = (partnerByDocNo.get(ext) ?? []).find((p) => !matchedPartnerIdx.has(p._idx));
      if (!hit) {
        const short = ext.includes("/") ? ext.substring(ext.lastIndexOf("/") + 1) : ext;
        if (short) {
          hit = partnerInvoices.find(
            (p) => !matchedPartnerIdx.has(p._idx) && p.docNo.toUpperCase().includes(short),
          );
        }
      }
    }
    if (hit) pushMatch(g, hit, "docno");
    else companyInvLeft.push(g);
  }

  // 3b. Fallback: amount+date. The two ERPs use different invoice numbers, and
  //     the company books net-of-TDS vs the partner's gross, so allow a TDS-sized
  //     tolerance and pick the nearest date.
  const amountDateMatched: CompanyTxn[] = [];
  for (const g of companyInvLeft) {
    const gAmt = companySigned(g);
    const sign = gAmt >= 0 ? 1 : -1;
    const tol = Math.max(5, Math.abs(g.tds) + 50);
    let best: PInv | undefined;
    let bestScore: [number, number] | undefined;
    for (const p of partnerInvoices) {
      if (matchedPartnerIdx.has(p._idx)) continue;
      if ((p.amount >= 0 ? 1 : -1) !== sign) continue;
      const adiff = Math.abs(p.amount - gAmt);
      if (adiff > tol) continue;
      const dd = g.date && p.date ? daysBetween(g.date, p.date) : 9999;
      if (dd > invoiceWindow) continue;
      const score: [number, number] = [dd, adiff];
      if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
        best = p;
        bestScore = score;
      }
    }
    if (best) {
      pushMatch(g, best, "amount-date");
      amountDateMatched.push(g);
    }
  }
  const stillUnmatchedCompanyInv = companyInvLeft.filter((g) => !amountDateMatched.includes(g));

  // 4. Unmatched invoices (both sides), with cut-off/timing reasons.
  const cutoffItems: CutoffItem[] = [];
  const unmatchedCompanyInv: UnmatchedCompanyInvoice[] = stillUnmatchedCompanyInv.map((g) => {
    let reason = g.extNo
      ? `Invoice '${g.extNo}' not found in the partner's books`
      : "No external reference number";
    if (partnerLast && g.date && g.date > partnerLast) {
      reason = `Timing — dated ${fmt(g.date)}, after the partner's last entry (${fmt(partnerLast)})`;
      cutoffItems.push({ side: "company", location: g.sheet, ref: g.docNo, date: g.date, amount: companySigned(g) });
    }
    return {
      sheet: g.sheet, date: g.date, docType: g.docType, docNo: g.docNo, extNo: g.extNo,
      tds: g.tds, debit: g.debit, credit: g.credit, reason,
    };
  });

  const unmatchedPartnerInv: UnmatchedPartnerInvoice[] = [];
  for (const p of partnerInvoices) {
    if (matchedPartnerIdx.has(p._idx)) continue;
    let reason = `Invoice '${p.docNo}' not found in your books`;
    if (companyLast && p.date && p.date > companyLast) {
      reason = `Timing — dated ${fmt(p.date)}, after your last entry (${fmt(companyLast)})`;
      cutoffItems.push({ side: "partner", location: p.location, ref: p.docNo, date: p.date, amount: p.amount });
    }
    unmatchedPartnerInv.push({
      location: p.location, date: p.date, docType: p.docType, docNo: p.docNo, amount: p.amount, reason,
    });
  }

  // 5. Payment matching — 1:1 exact (wider window), then split (one company lump
  //    = several partner receipts within the window summing to it).
  const matchedPayments: MatchedPayment[] = [];
  const unmatchedCompanyPay: UnmatchedCompanyPayment[] = [];
  const usedPay = new Set<number>();

  for (const g of companyPay) {
    const amt = r2(g.debit);
    const dt = g.date;
    let one: PInv | null = null;
    if (dt) {
      for (const p of partnerPayments) {
        if (usedPay.has(p._idx)) continue;
        if (r2(Math.abs(p.amount)) !== amt) continue;
        if (!p.date || daysBetween(p.date, dt) > paymentWindow) continue;
        one = p;
        break;
      }
    }
    if (one) {
      usedPay.add(one._idx);
      matchedPayments.push({
        location: one.location, companyRef: g.docNo, companyDate: dt, amount: amt,
        partnerRef: one.docNo, partnerDate: one.date, status: "Matched",
      });
      continue;
    }
    // split: greedily accumulate same-sign receipts near the company date.
    if (dt) {
      const cands = partnerPayments
        .filter((p) => !usedPay.has(p._idx) && p.date && daysBetween(p.date, dt) <= invoiceWindow)
        .sort((a, b) => daysBetween(a.date!, dt) - daysBetween(b.date!, dt));
      const pick: PInv[] = [];
      let sum = 0;
      for (const p of cands) {
        if (pick.length >= 8) break;
        if (Math.abs(p.amount) - 0.01 > amt - sum) continue; // don't overshoot
        pick.push(p);
        sum = r2(sum + Math.abs(p.amount));
        if (sum === amt) break;
      }
      if (sum === amt && pick.length > 1) {
        for (const p of pick) usedPay.add(p._idx);
        matchedPayments.push({
          location: pick[0].location, companyRef: g.docNo, companyDate: dt, amount: amt,
          partnerRef: `${pick.length} receipts`, partnerDate: pick[0].date, status: "Matched",
          count: pick.length,
        });
        continue;
      }
    }
    unmatchedCompanyPay.push({
      companyRef: g.docNo, date: dt, amount: amt,
      reason: "Payment not found in the partner's books",
    });
  }

  // 6. Closing balances + sign labels.
  const companyClosing = company.closingBal;
  const partnerClosing = partner.totalClosing;
  const companySignLabel =
    companyClosing < 0 ? `Business Partner owes YOU ${inr(companyClosing)} (you overpaid)`
    : companyClosing > 0 ? `You owe Business Partner ${inr(companyClosing)}`
    : "ZERO — fully settled";
  const partnerSignLabel =
    partnerClosing > 0 ? `YOU owe Business Partner ${inr(partnerClosing)}`
    : partnerClosing < 0 ? `Business Partner owes YOU ${inr(partnerClosing)}`
    : "ZERO — fully settled";
  const oppositeDirections =
    (companyClosing < 0 && partnerClosing > 0) || (companyClosing > 0 && partnerClosing < 0);
  const totalGap = oppositeDirections
    ? Math.abs(companyClosing) + Math.abs(partnerClosing)
    : Math.abs(partnerClosing - companyClosing);

  // 7. Per-location summary.
  const locationSummary: LocationSummary[] = partner.locations.map((loc) => ({
    location: loc.location,
    openingBal: loc.openingBal,
    closingBal: loc.closingBal,
    matchedInv: matchedInvoices.filter((m) => m.location === loc.location).length,
    status: Math.abs(loc.closingBal) < 1 ? "Settled" : "Outstanding",
  }));

  // 8. TDS + gap analysis.
  const tdsCompanyDeducted = r2(companyInv.reduce((s, g) => s + (g.tds || 0), 0));
  const tdsPartnerCredited = r2(
    partner.locations.flatMap((l) => l.transactions).filter(isPartnerTds).reduce((s, t) => s + Math.abs(t.amount), 0),
  );
  const totalTds = matchedInvoices.reduce((s, m) => s + m.tdsDeducted, 0);
  cutoffItems.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const gapAnalysis: GapAnalysis = {
    totalGap,
    tdsCompanyDeducted,
    tdsPartnerCredited,
    tdsNet: r2(tdsCompanyDeducted - tdsPartnerCredited),
    cutoffItems,
    cutoffTotal: r2(cutoffItems.reduce((s, c) => s + c.amount, 0)),
    companyLastDate: companyLast,
    partnerLastDate: partnerLast,
    matchedInvoiceCount: matchedInvoices.length,
    amountDateMatchedCount: amountDateMatched.length,
  };

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
    gapAnalysis,
  };
}

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

function inr(n: number): string {
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
