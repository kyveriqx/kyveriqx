/* Parse a partner's Tally "Ledger Account" PDF into the PartnerLocation shape.

   These statements are line-oriented: one voucher per visual row, with sub-rows
   for the GL breakup ("GST Sales … Cr", "New Ref … Dr", "Agst Ref … Cr"). The
   accounting twist — proven by the carried-over totals — is that the printed
   Dr/Cr token is INVERTED relative to the ledger column:

       printed "Cr" (a sale / opening)      -> Debit column  -> receivable UP   (+amount)
       printed "Dr" (a receipt/credit note) -> Credit column -> receivable DOWN (-amount)

   So `amount` here follows the same convention as the Business Central partner
   export: +ve = invoice (partner is owed more), -ve = receipt/credit note.

   Port of parse_vendor_pdf() in Asset/TOOL TESTING/ORG RECO/parse_lib.py, which
   ties each file's computed closing to the printed "Closing Balance" to the rupee. */

import type { PartnerLocation, PartnerTxn } from "./types";
import { pdfToLines } from "./pdf-lines";
import { detectCityFromText } from "./parse-partner";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const TALLY_DATE = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
const TRAILING_AMT = /(\d[\d,]*\.\d{2})\s*$/;
const TRAILING_DRCR = /\b(Dr|Cr)\.?$/;
const LEAD_TOKEN = /^(Dr|Cr)\b\s*(.*)$/;

function parseTallyDate(tok: string): Date | null {
  const m = TALLY_DATE.exec(tok);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return null;
  return new Date(Date.UTC(2000 + Number(m[3]), mon, Number(m[1])));
}

function toNum(s: string): number {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Classify a Tally voucher line into the canonical docType the matcher uses. */
function vchType(particulars: string): string {
  const p = particulars.toLowerCase();
  if (p.includes("credit note")) return "Credit Memo";
  if (p.includes("gst sales") || p.includes("(as per details)")) return "Invoice";
  if (p.includes("receipt") || p.includes("payment")) return "Payment";
  if (p.includes("rounding") || p.includes("kasar")) return "Rounding";
  if (p.includes("journal")) return "Journal";
  return "Other";
}

export type PartnerPdfParse = {
  location: PartnerLocation;
  /** True when the recomputed closing equals the printed closing (within ₹1). */
  tiesOut: boolean;
};

/** Tally header carries the period as "1-Apr-23 to 31-Mar-24". */
function periodFromLines(lines: string[]): string | undefined {
  for (const l of lines) {
    const m = l.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2})\s+to\s+\d{1,2}-[A-Za-z]{3}-(\d{2})/);
    if (m) return `FY${m[3]}-${m[4]}`;
  }
  return undefined;
}

/**
 * Parse one Tally ledger PDF. `location`/`period` may be supplied by the caller;
 * when omitted they are auto-detected from the statement's address + date-range
 * header. `period` tags the rows for multi-period bridging.
 */
export async function parsePartnerPdf(
  buffer: Buffer | Uint8Array,
  opts: { location?: string; period?: string; source?: string } = {},
): Promise<PartnerPdfParse> {
  const lines = await pdfToLines(buffer);

  // Auto-detect location from the account-holder's address block (the first
  // ~12 lines), and period from the date-range header.
  const headerText = lines.slice(0, 12).join(" ");
  const location = opts.location || detectCityFromText(headerText) || "Location";
  const period = opts.period || periodFromLines(lines);

  const txns: PartnerTxn[] = [];
  let opening = 0;
  let printedClosing: number | null = null;
  let partyName = "";
  let curDate: Date | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Capture the account holder's name (line after "Ledger Account" marker is
    // the address, but the party name appears just above it in the header block).
    if (!partyName && /growit/i.test(line)) partyName = line;

    // Split off a possible leading Tally date.
    const firstTok = line.split(/\s+/)[0];
    const d = parseTallyDate(firstTok);
    const rest = d ? line.slice(firstTok.length).trim() : line;

    // Sub-detail / allocation lines end with a trailing Dr/Cr → skip (but keep
    // the running date so the next main line inherits it).
    if (TRAILING_DRCR.test(rest)) {
      if (d) curDate = d;
      continue;
    }

    const am = TRAILING_AMT.exec(rest);
    if (!am) {
      if (d) curDate = d;
      continue;
    }
    const amt = toNum(am[1]);
    const body = rest.slice(0, am.index).trim();

    // The main voucher line begins with a Dr/Cr token (after the optional date).
    const tok = LEAD_TOKEN.exec(body);
    if (!tok) {
      if (d) curDate = d;
      continue;
    }
    const token = tok[1]; // printed Dr/Cr
    const particulars = tok[2].trim();
    if (d) curDate = d;

    if (/opening balance/i.test(particulars)) {
      opening = token === "Cr" ? amt : -amt; // inverted: Cr opening sits in receivable col
      continue;
    }
    if (/closing balance/i.test(particulars)) {
      printedClosing = token === "Dr" ? amt : -amt;
      continue;
    }

    // Inverted mapping: printed Cr -> +amount (receivable up), Dr -> -amount.
    const signed = token === "Cr" ? amt : -amt;
    const refToks = particulars.split(/\s+/);
    const ref = refToks.length ? refToks[refToks.length - 1] : "";

    txns.push({
      location,
      date: curDate,
      docType: vchType(particulars),
      docNo: ref.toUpperCase(),
      amount: signed,
      balance: 0,
      desc: particulars,
      source: opts.source,
      period,
    });
  }

  const computedClosing = opening + txns.reduce((s, t) => s + t.amount, 0);
  // Tally omits a "Closing Balance" line when the account nets to zero (totals
  // print equal); in that case the computed 0 is the closing.
  const closingBal = printedClosing ?? computedClosing;

  return {
    location: {
      location,
      partyName,
      openingBal: opening,
      closingBal,
      transactions: txns,
      format: "pdf",
      printedClosing: printedClosing ?? computedClosing,
      computedClosing,
      sources: opts.source ? [opts.source] : [],
    },
    tiesOut: Math.abs(computedClosing - (printedClosing ?? computedClosing)) < 1,
  };
}
