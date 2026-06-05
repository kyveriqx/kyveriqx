/* Parse the company's own Tally "Ledger Account" PDF (its books for ONE business
   partner) into the CompanyLedger shape.

   The company keeps the partner as a VENDOR (creditor): a purchase invoice is a
   credit (payable up), a payment is a debit (payable down), and the closing is
   usually Cr (you owe the vendor). Tally's printed Dr/Cr token is inverted in some
   exports, so rather than hard-code a mapping we try BOTH and keep the one whose
   running balance ties to the printed closing — the same control-total guarantee
   the Excel/partner parsers give.

   Sign convention of the returned CompanyLedger.closingBal matches the Excel
   parser: positive = company owes the partner, negative = company overpaid. */

import type { CompanyLedger, CompanyTxn, DrCr } from "./types";
import { extractTallyLedger, tallyVchType, type TallyVoucher, type DrCrToken } from "./tally-ledger";

export type CompanyPdfParse = { ledger: CompanyLedger; tiesOut: boolean };

/** Signed movement under a chosen interpretation, in payable terms (Cr = +). */
function movement(v: TallyVoucher, creditToken: DrCrToken): number {
  return v.token === creditToken ? v.amount : -v.amount;
}

export async function parseCompanyPdf(
  buffer: Buffer | Uint8Array,
  opts: { source?: string } = {},
): Promise<CompanyPdfParse> {
  const t = await extractTallyLedger(buffer);

  // Printed closing in payable terms: Cr = you owe (+), Dr = overpaid (−).
  const printedClosing = t.closingToken
    ? (t.closingToken === "Cr" ? t.closingAmount! : -t.closingAmount!)
    : null;

  // Try both interpretations of which printed token means "credit" (payable up)
  // and keep whichever ties the running balance to the printed closing.
  let creditToken: DrCrToken = "Cr";
  if (printedClosing != null) {
    const candidates: DrCrToken[] = ["Cr", "Dr"];
    let best = candidates[0];
    let bestErr = Infinity;
    for (const c of candidates) {
      const opening = t.openingToken
        ? (t.openingToken === c ? t.openingAmount : -t.openingAmount)
        : 0;
      const close = opening + t.vouchers.reduce((s, v) => s + movement(v, c), 0);
      const err = Math.abs(close - printedClosing);
      if (err < bestErr) { bestErr = err; best = c; }
    }
    creditToken = best;
  }

  const opening = t.openingToken
    ? (t.openingToken === creditToken ? t.openingAmount : -t.openingAmount)
    : 0;

  const records: CompanyTxn[] = t.vouchers.map((v) => {
    const signed = movement(v, creditToken); // + = credit (purchase), − = debit (payment)
    return {
      sheet: "PDF",
      date: v.date,
      docType: tallyVchType(v.particulars),
      docNo: v.ref,
      extNo: v.ref, // in the company's books the vendor invoice no is the reference
      tds: 0,
      debit: signed < 0 ? -signed : 0,
      credit: signed > 0 ? signed : 0,
      balance: 0,
      opening,
      closing: 0,
    };
  });

  const computedClosing = opening + records.reduce((s, r) => s + (r.credit - r.debit), 0);
  const rawClose = printedClosing != null ? Math.abs(printedClosing) : Math.abs(computedClosing);
  const closingDrCr: DrCr = (printedClosing ?? computedClosing) < 0 ? "Dr" : "Cr";
  const closingBal = closingDrCr === "Dr" ? -rawClose : rawClose;

  let minDate: Date | null = null;
  for (const r of records) if (r.date && (!minDate || r.date < minDate)) minDate = r.date;

  return {
    ledger: {
      partyName: t.partyName,
      openingBal: opening,
      closingBal,
      closingRaw: rawClose,
      closingDrCr,
      transactions: records,
      minDate,
    },
    tiesOut: printedClosing == null || Math.abs(computedClosing - printedClosing) < 1,
  };
}
