/* Narration keyword classification.

   The matcher groups candidates by payment channel (the user chose
   "narration keywords + same day"), and classifies leftover bank-only lines
   into bank charges / interest / TDS so the UI can pre-bucket exceptions.

   Everything here is advisory: it raises confidence and labels rows, but a
   wrong guess never blocks a sum-based match. Matching keywords on word
   TOKENS (not raw substrings) keeps "interest" out of "printing" etc. */

import type { UnmatchedHint } from "./types";

/** Payment-channel keywords. A bank line and a book row "share a channel"
 *  when both mention the same one — used to scope group matching. */
const CHANNEL_KEYWORDS: Record<string, string[]> = {
  upi: ["upi", "bhim", "vpa"],
  imps: ["imps"],
  neft: ["neft"],
  rtgs: ["rtgs"],
  card: ["pos", "card", "visa", "mastercard", "rupay", "ecom"],
  chq: ["chq", "cheque", "clg", "clearing"],
};

/** Payment-gateway brands — their bank credits arrive net of a fee, so the
 *  group-fee pass only fires when a gateway is in play. */
const GATEWAY_KEYWORDS = [
  "razorpay", "rzp", "rzpx", "payu", "ccavenue", "ccav", "paytm",
  "billdesk", "cashfree", "instamojo", "pinelabs", "easebuzz", "phonepe",
];

const CHARGE_TOKENS = [
  "chrg", "chrgs", "charge", "charges", "fee", "fees", "comm", "commission",
  "amc", "sms", "penalty", "gst",
];
const CHARGE_PHRASES = [
  "service charge", "min bal", "minimum balance", "maintenance",
  "non maintenance", "incidental", "processing charge",
];

const INTEREST_TOKENS = ["interest", "int", "intt"];
const INTEREST_PHRASES = ["int credit", "int pd", "credit interest", "saving interest"];

const TDS_TOKENS = ["tds"];
const TDS_PHRASES = ["tax deducted"];

const REVERSAL_TOKENS = ["rev", "reversal", "reversed", "refund", "refunded", "return", "returned", "chgbk", "chargeback"];

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function hasToken(tok: Set<string>, words: string[]): boolean {
  return words.some((w) => tok.has(w));
}

function hasPhrase(s: string, phrases: string[]): boolean {
  const low = s.toLowerCase();
  return phrases.some((p) => low.includes(p));
}

/** First channel mentioned in a description, or null. "@" alone implies a UPI VPA. */
export function detectChannel(desc: string): string | null {
  const tok = tokens(desc);
  for (const [channel, words] of Object.entries(CHANNEL_KEYWORDS)) {
    if (hasToken(tok, words)) return channel;
  }
  if (desc.includes("@")) return "upi";
  return null;
}

/** True when both descriptions name the same payment channel. */
export function shareChannel(a: string, b: string): boolean {
  const ca = detectChannel(a);
  return ca !== null && ca === detectChannel(b);
}

export function isGateway(desc: string): boolean {
  const tok = tokens(desc);
  return hasToken(tok, GATEWAY_KEYWORDS);
}

export function looksLikeReversal(desc: string): boolean {
  return hasToken(tokens(desc), REVERSAL_TOKENS);
}

/** Bucket a leftover bank line. credit = inflow (interest), debit = outflow
 *  (charge / TDS). Order matters: TDS before the broader charge match. */
export function classifyUnmatched(desc: string, debit: number, credit: number): UnmatchedHint {
  const tok = tokens(desc);
  const isDebit = debit > 0 && credit === 0;
  const isCredit = credit > 0 && debit === 0;

  if (isDebit && (hasToken(tok, TDS_TOKENS) || hasPhrase(desc, TDS_PHRASES))) return "tds";
  if (isCredit && (hasToken(tok, INTEREST_TOKENS) || hasPhrase(desc, INTEREST_PHRASES))) return "interest";
  if (isDebit && (hasToken(tok, CHARGE_TOKENS) || hasPhrase(desc, CHARGE_PHRASES))) return "bank-charge";
  if (looksLikeReversal(desc)) return "possible-reversal";
  return null;
}
