/* Low-level reader for a Tally "Ledger Account" PDF — shared by the partner
   (customer) and company (vendor) PDF parsers.

   Tally ledgers are line-oriented: one voucher per visual row, with sub-rows for
   the GL breakup ("GST Sales … Cr", "New Ref … Dr", "Agst Ref … Cr"). This module
   extracts the NEUTRAL facts only — date, the printed Dr/Cr token, particulars,
   reference and amount — plus the opening/closing markers with their tokens. It
   does NOT decide what the token means for the balance: the printed Dr/Cr is
   inverted relative to the ledger column in some exports, so each caller resolves
   the sign by tying the running balance to the printed closing (control total). */

import { pdfToLines } from "./pdf-lines";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const TALLY_DATE = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
const TRAILING_AMT = /(\d[\d,]*\.\d{2})\s*$/;
const TRAILING_DRCR = /\b(Dr|Cr)\.?$/;
const LEAD_TOKEN = /^(Dr|Cr)\b\s*(.*)$/;

export type DrCrToken = "Dr" | "Cr";

export type TallyVoucher = {
  date: Date | null;
  token: DrCrToken;       // printed Dr/Cr (NOT yet resolved to a column)
  particulars: string;
  ref: string;            // last token of the particulars (the voucher/invoice no)
  amount: number;
};

export type TallyLedgerRaw = {
  vouchers: TallyVoucher[];
  openingAmount: number;
  openingToken: DrCrToken | null;
  closingAmount: number | null;
  closingToken: DrCrToken | null;
  partyName: string;      // the account holder (the line above "Ledger Account")
  headerText: string;     // first ~12 lines joined (for location detection)
  period?: string;        // e.g. "FY23-24" from the "1-Apr-23 to 31-Mar-24" header
};

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

function periodFromLines(lines: string[]): string | undefined {
  for (const l of lines) {
    const m = l.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2})\s+to\s+\d{1,2}-[A-Za-z]{3}-(\d{2})/);
    if (m) return `FY${m[3]}-${m[4]}`;
  }
  return undefined;
}

export async function extractTallyLedger(buffer: Buffer | Uint8Array): Promise<TallyLedgerRaw> {
  const lines = await pdfToLines(buffer);
  const headerText = lines.slice(0, 12).join(" ");
  const period = periodFromLines(lines);

  // Party = the account holder, printed just above the "Ledger Account" marker.
  let partyName = "";
  const laIdx = lines.findIndex((l) => /^ledger account\b/i.test(l.trim()));
  if (laIdx > 0) partyName = lines[laIdx - 1].trim();

  const vouchers: TallyVoucher[] = [];
  let openingAmount = 0;
  let openingToken: DrCrToken | null = null;
  let closingAmount: number | null = null;
  let closingToken: DrCrToken | null = null;
  let curDate: Date | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

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

    const tok = LEAD_TOKEN.exec(body);
    if (!tok) {
      if (d) curDate = d;
      continue;
    }
    const token = tok[1] as DrCrToken;
    const particulars = tok[2].trim();
    if (d) curDate = d;

    if (/opening balance/i.test(particulars)) {
      openingAmount = amt;
      openingToken = token;
      continue;
    }
    if (/closing balance/i.test(particulars)) {
      closingAmount = amt;
      closingToken = token;
      continue;
    }

    const refToks = particulars.split(/\s+/);
    vouchers.push({
      date: curDate,
      token,
      particulars,
      ref: (refToks.length ? refToks[refToks.length - 1] : "").toUpperCase(),
      amount: amt,
    });
  }

  return {
    vouchers, openingAmount, openingToken, closingAmount, closingToken,
    partyName, headerText, period,
  };
}

/** Classify a Tally voucher line into the canonical docType the matcher uses. */
export function tallyVchType(particulars: string): string {
  const p = particulars.toLowerCase();
  if (p.includes("credit note")) return "Credit Memo";
  if (p.includes("gst sales") || p.includes("purchase") || p.includes("(as per details)")) return "Invoice";
  if (p.includes("receipt") || p.includes("payment") || p.includes("bank")) return "Payment";
  if (p.includes("rounding") || p.includes("kasar")) return "Rounding";
  if (p.includes("journal")) return "Journal";
  return "Other";
}
