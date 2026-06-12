/* Customer list parser — CSV or Excel into Recipient[].

   The user uploads a sheet with at minimum an email column. Everything
   else is optional and powers the merge fields in the reminder:
       Email           → email (required)
       Name / Customer  → name        ({{name}})
       Currency         → currency    ({{currency}}, e.g. INR / USD)
       Amount Due       → amount      ({{amount}})
       Invoice No       → invoiceNumber  ({{invoice_number}})
       Invoice Details  → invoiceDetails ({{invoice_details}})
       Due Date         → dueDate     ({{due_date}})

   We auto-detect each header by token-set matching, so column order
   doesn't matter and small label variations are tolerated.

   xlsx handles both CSV and XLSX from the same Buffer entry point. */

import * as XLSX from "xlsx";
import type { Recipient } from "./types";

const EMAIL_KEYS = [
  "Email", "E-mail", "Email Address", "Mail", "To",
  "Recipient", "Recipient Email", "Customer Email",
];

const NAME_KEYS = [
  "Name", "Full Name", "Customer", "Customer Name",
  "Debtor", "Debtor Name", "Party", "Party Name",
  "First Name", "Contact", "Contact Name",
];

const CURRENCY_KEYS = [
  "Currency", "Currency Code", "Curr", "Ccy",
];

const AMOUNT_KEYS = [
  "Amount", "Amount Due", "Pending Amount", "Total Due",
  "Due Amount", "Invoice Amount",
];

const INVOICE_NO_KEYS = [
  "Invoice", "Invoice No", "Invoice Number", "Bill No",
  "Bill Number", "Reference", "Reference No",
];

const INVOICE_DETAILS_KEYS = [
  "Invoice Details", "Description", "Particulars",
  "Line Items", "Details",
];

const DUE_DATE_KEYS = [
  "Due Date", "Payment Date", "Due", "Pay By", "Invoice Date",
];

// Basic RFC-5321-ish sanity check — enough to drop typos and blank cells
// without re-implementing the spec. Real validity is decided by the SMTP
// server on send.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldKey =
  | "email" | "name" | "currency" | "amount"
  | "invoiceNumber" | "invoiceDetails" | "dueDate";

// Order doesn't affect detection (assignment is column-centric and
// score-driven), but it documents the fields we look for.
const FIELDS: { key: FieldKey; keys: string[] }[] = [
  { key: "email", keys: EMAIL_KEYS },
  { key: "name", keys: NAME_KEYS },
  { key: "currency", keys: CURRENCY_KEYS },
  { key: "amount", keys: AMOUNT_KEYS },
  { key: "invoiceNumber", keys: INVOICE_NO_KEYS },
  { key: "invoiceDetails", keys: INVOICE_DETAILS_KEYS },
  { key: "dueDate", keys: DUE_DATE_KEYS },
];

function tokenize(s: string): Set<string> {
  return new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/** Best token-overlap score of a header against a candidate label list.
 *  Rewards full overlap; penalises both extra header tokens AND unmatched
 *  candidate tokens, so a partial hit ("Customer" vs "Customer Email") scores
 *  below an exact hit ("Customer" vs the name label "Customer"). */
function scoreField(headerTokens: Set<string>, candidates: string[]): number {
  let best = 0;
  for (const cand of candidates) {
    const c = tokenize(cand);
    let overlap = 0;
    for (const t of c) if (headerTokens.has(t)) overlap++;
    if (overlap === 0) continue;
    const score =
      overlap
      - 0.1 * Math.max(0, headerTokens.size - overlap)
      - 0.1 * Math.max(0, c.size - overlap);
    if (score > best) best = score;
  }
  return best;
}

/** Map each header column to the single field it matches best, so a shared
 *  token (e.g. "Due" in "Amount Due") can't make one column fill several
 *  fields. Each field keeps only its highest-scoring column. */
function detectColumns(headers: unknown[]): Record<FieldKey, number> {
  const result: Record<FieldKey, number> = {
    email: -1, name: -1, currency: -1, amount: -1,
    invoiceNumber: -1, invoiceDetails: -1, dueDate: -1,
  };
  const bestScore: Record<FieldKey, number> = {
    email: 0, name: 0, currency: 0, amount: 0,
    invoiceNumber: 0, invoiceDetails: 0, dueDate: 0,
  };

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const tokens = h == null ? new Set<string>() : tokenize(String(h));
    if (tokens.size === 0) continue;

    // Which field does THIS column belong to? The one whose labels score highest.
    let winner: FieldKey | null = null;
    let winnerScore = 0;
    for (const f of FIELDS) {
      const s = scoreField(tokens, f.keys);
      if (s > winnerScore) { winnerScore = s; winner = f.key; }
    }
    if (winner && winnerScore > bestScore[winner]) {
      bestScore[winner] = winnerScore;
      result[winner] = i;
    }
  }
  return result;
}

export type ParseResult = {
  recipients: Recipient[];
  /** Rows present in the file but dropped for missing/invalid email. */
  dropped: number;
  /** Total non-empty data rows seen (recipients.length + dropped). */
  totalRows: number;
};

function cell(row: unknown[], idx: number): string {
  return idx >= 0 ? String(row[idx] ?? "").trim() : "";
}

export function parseRecipients(buffer: Buffer): ParseResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { recipients: [], dropped: 0, totalRows: 0 };

  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
  if (rows.length === 0) return { recipients: [], dropped: 0, totalRows: 0 };

  const headers = rows[0] as unknown[];
  const cols = detectColumns(headers);
  if (cols.email < 0) {
    throw new Error(
      "Could not find an email column. Add a header named 'Email' (or similar) on the first row.",
    );
  }

  const recipients: Recipient[] = [];
  let dropped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;
    const rawEmail = String(row[cols.email] ?? "").trim().toLowerCase();
    if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
      dropped++;
      continue;
    }
    recipients.push({
      email: rawEmail,
      name: cell(row, cols.name),
      currency: cell(row, cols.currency),
      amount: cell(row, cols.amount),
      invoiceNumber: cell(row, cols.invoiceNumber),
      invoiceDetails: cell(row, cols.invoiceDetails),
      dueDate: cell(row, cols.dueDate),
    });
  }

  return {
    recipients,
    dropped,
    totalRows: recipients.length + dropped,
  };
}
