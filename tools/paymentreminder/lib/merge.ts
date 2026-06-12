/* Multi-field mail-merge helper for payment reminders.

   Supports {{name}}, {{email}}, {{currency}}, {{amount}},
   {{invoice_number}}, {{invoice_details}} and {{due_date}}. Tokens are
   case-insensitive and tolerate inner whitespace ({{ Invoice_Number }}).

   A known token with no value yields the empty string — the surrounding
   template controls the fallback ("amount is {{amount}}" becomes
   "amount is " which is the user's choice to make). An unknown token is
   left untouched so a mistyped field stays visible rather than silently
   vanishing.

   `extra` carries consolidated-mode tokens ({{total}}, {{invoice_table}},
   {{count}}); its keys are lower-cased and override the per-row fields. */

import type { Recipient } from "./types";

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export function applyMerge(
  template: string,
  row: Partial<Recipient>,
  extra?: Record<string, string>,
): string {
  const values: Record<string, string> = {
    name: (row.name ?? "").trim(),
    email: (row.email ?? "").trim(),
    currency: (row.currency ?? "").trim(),
    amount: (row.amount ?? "").trim(),
    invoice_number: (row.invoiceNumber ?? "").trim(),
    invoice_details: (row.invoiceDetails ?? "").trim(),
    due_date: (row.dueDate ?? "").trim(),
  };
  if (extra) {
    for (const k of Object.keys(extra)) {
      values[k.toLowerCase()] = extra[k] ?? "";
    }
  }
  return template.replace(TOKEN_RE, (match, tokenRaw: string) => {
    const key = String(tokenRaw).toLowerCase();
    return key in values ? values[key] : match;
  });
}
