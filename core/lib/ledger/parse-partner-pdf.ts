/* Parse a partner's Tally "Ledger Account" PDF into the PartnerLocation shape.

   The partner keeps the company as a CUSTOMER (debtor). The printed Dr/Cr token
   is INVERTED relative to the ledger column (proven by the carried-over totals):

       printed "Cr" (a sale / opening)      -> receivable UP   (+amount)
       printed "Dr" (a receipt/credit note) -> receivable DOWN (-amount)

   So `amount` follows the same convention as the Business Central partner export:
   +ve = invoice (partner is owed more), -ve = receipt/credit note. The low-level
   line reading lives in tally-ledger.ts; here we only resolve the sign and tag
   location/period. */

import type { PartnerLocation, PartnerTxn } from "./types";
import { extractTallyLedger, tallyVchType } from "./tally-ledger";
import { detectCityFromText } from "./parse-partner";

export type PartnerPdfParse = {
  location: PartnerLocation;
  /** True when the recomputed closing equals the printed closing (within ₹1). */
  tiesOut: boolean;
};

/**
 * Parse one Tally ledger PDF. `location`/`period` may be supplied by the caller;
 * when omitted they are auto-detected from the statement's address + date-range
 * header. `period` tags the rows for multi-period bridging.
 */
export async function parsePartnerPdf(
  buffer: Buffer | Uint8Array,
  opts: { location?: string; period?: string; source?: string } = {},
): Promise<PartnerPdfParse> {
  const t = await extractTallyLedger(buffer);

  const location = opts.location || detectCityFromText(t.headerText) || "Location";
  const period = opts.period || t.period;

  // Inverted mapping: printed Cr -> +amount (receivable up), Dr -> -amount.
  const txns: PartnerTxn[] = t.vouchers.map((v) => ({
    location,
    date: v.date,
    docType: tallyVchType(v.particulars),
    docNo: v.ref,
    amount: v.token === "Cr" ? v.amount : -v.amount,
    balance: 0,
    desc: v.particulars,
    source: opts.source,
    period,
  }));

  const opening = t.openingToken === "Dr" ? -t.openingAmount : t.openingAmount;
  // Printed closing: a Dr closing is a receivable (+), a Cr closing is a credit (−).
  const printedClosing = t.closingToken
    ? (t.closingToken === "Dr" ? t.closingAmount! : -t.closingAmount!)
    : null;

  const computedClosing = opening + txns.reduce((s, x) => s + x.amount, 0);
  const closing = printedClosing ?? computedClosing;

  return {
    location: {
      location,
      partyName: t.partyName,
      openingBal: opening,
      closingBal: closing,
      transactions: txns,
      format: "pdf",
      printedClosing: printedClosing ?? computedClosing,
      computedClosing,
      sources: opts.source ? [opts.source] : [],
    },
    tiesOut: Math.abs(computedClosing - (printedClosing ?? computedClosing)) < 1,
  };
}
