/* Recipient list parser — CSV or Excel into Recipient[].

   The user uploads a sheet with at minimum an email column. A name
   column is optional (used by the {{name}} merge field).

   We auto-detect the header by token-set matching, so column order
   doesn't matter and small label variations are tolerated:
       Email / E-mail / Email Address / Mail / To  → email
       Name / Full Name / Customer / First Name    → name

   xlsx handles both CSV and XLSX from the same Buffer entry point. */

import * as XLSX from "xlsx";
import type { Recipient } from "./types";

const EMAIL_KEYS = [
  "Email", "E-mail", "Email Address", "Mail", "To",
  "Recipient", "Recipient Email",
];

const NAME_KEYS = [
  "Name", "Full Name", "Customer", "Customer Name",
  "First Name", "Recipient Name", "Contact", "Contact Name",
];

// Basic RFC-5321-ish sanity check — enough to drop typos and blank cells
// without re-implementing the spec. Real validity is decided by the SMTP
// server on send.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tokenize(s: string): Set<string> {
  return new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function pickColumn(headers: unknown[], candidates: string[]): number {
  const headerTokens = headers.map((h) =>
    h == null ? new Set<string>() : tokenize(String(h)),
  );
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < headerTokens.length; i++) {
    const h = headerTokens[i];
    if (h.size === 0) continue;
    for (const cand of candidates) {
      const c = tokenize(cand);
      let overlap = 0;
      for (const t of c) if (h.has(t)) overlap++;
      if (overlap === 0) continue;
      // Reward full overlap; penalise extra header tokens (less specific match).
      const score = overlap - 0.1 * Math.max(0, h.size - overlap);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

export type ParseResult = {
  recipients: Recipient[];
  /** Rows present in the file but dropped for missing/invalid email. */
  dropped: number;
  /** Total non-empty data rows seen (recipients.length + dropped). */
  totalRows: number;
};

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
  const emailIdx = pickColumn(headers, EMAIL_KEYS);
  if (emailIdx < 0) {
    throw new Error(
      "Could not find an email column. Add a header named 'Email' (or similar) on the first row.",
    );
  }
  const nameIdx = pickColumn(headers, NAME_KEYS); // may be -1

  const recipients: Recipient[] = [];
  let dropped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;
    const rawEmail = String(row[emailIdx] ?? "").trim().toLowerCase();
    if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
      dropped++;
      continue;
    }
    const name =
      nameIdx >= 0 ? String(row[nameIdx] ?? "").trim() : "";
    recipients.push({ email: rawEmail, name });
  }

  return {
    recipients,
    dropped,
    totalRows: recipients.length + dropped,
  };
}
