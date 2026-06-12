/* Consolidation helpers for the "one email per customer" send mode.

   When a customer has several pending invoices (several rows sharing an email),
   we group those rows and build a single email: an itemized HTML table of every
   invoice plus an auto-summed total. This logic is shared between the live
   preview (client) and the Trigger.dev send task (server) so both render an
   identical email. */

import type { Recipient } from "./types";

/** Group recipients by (lower-cased) email, preserving first-seen order both
 *  for the groups and the rows inside each group. */
export function groupByEmail(recipients: Recipient[]): Recipient[][] {
  const order: string[] = [];
  const byEmail = new Map<string, Recipient[]>();
  for (const r of recipients) {
    const key = r.email.trim().toLowerCase();
    let bucket = byEmail.get(key);
    if (!bucket) {
      bucket = [];
      byEmail.set(key, bucket);
      order.push(key);
    }
    bucket.push(r);
  }
  return order.map((k) => byEmail.get(k)!);
}

/** Parse a human-entered amount ("12,000", " 8500 ", "1,200.50") into a number.
 *  Returns null when there's no parseable number — currency is a separate code
 *  column, so there's no symbol to strip here. */
export function parseAmount(s: string): number | null {
  if (s == null) return null;
  // Keep digits, dot and minus; drop commas, spaces and stray text.
  const cleaned = String(s).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Format a number with comma-grouped thousands. Deterministic (not locale
 *  dependent) so the preview and the sent email always match. Keeps up to two
 *  decimal places, trimming a trailing ".00". */
export function formatAmount(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const rounded = Math.round(abs * 100) / 100;
  let [intPart, decPart = ""] = rounded.toFixed(2).split(".");
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = decPart === "00" ? intPart : `${intPart}.${decPart}`;
  return neg ? `-${body}` : body;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The currency code to show for the group — first non-empty value, else "". */
function groupCurrency(rows: Recipient[]): string {
  for (const r of rows) {
    const c = (r.currency ?? "").trim();
    if (c) return c;
  }
  return "";
}

/** Sum of all parseable amounts in the group. */
export function sumAmounts(rows: Recipient[]): number {
  let total = 0;
  for (const r of rows) {
    const n = parseAmount(r.amount);
    if (n != null) total += n;
  }
  return total;
}

/** Build an email-safe (inline-styled) HTML table of every invoice in the
 *  group, with a trailing Total row summing the parseable amounts. */
export function buildInvoiceTableHtml(rows: Recipient[]): string {
  const currency = groupCurrency(rows);
  const th =
    'style="text-align:left;padding:8px 10px;border-bottom:2px solid #d1d5db;' +
    'font-size:13px;color:#374151;"';
  const thRight = th.replace("text-align:left", "text-align:right");
  const td =
    'style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#1f2937;"';
  const tdRight = td.replace("padding:8px 10px;", "padding:8px 10px;text-align:right;");

  const body = rows
    .map((r) => {
      const amt = parseAmount(r.amount);
      const amtCell = amt != null ? formatAmount(amt) : esc(r.amount ?? "");
      return (
        "<tr>" +
        `<td ${td}>${esc(r.invoiceNumber ?? "")}</td>` +
        `<td ${td}>${esc(r.invoiceDetails ?? "")}</td>` +
        `<td ${td}>${esc(r.dueDate ?? "")}</td>` +
        `<td ${tdRight}>${esc(amtCell)}</td>` +
        "</tr>"
      );
    })
    .join("");

  const totalLabel = currency ? `Total (${esc(currency)})` : "Total";
  const totalCell = formatAmount(sumAmounts(rows));

  return (
    '<table style="border-collapse:collapse;width:100%;margin:8px 0 4px;">' +
    "<thead><tr>" +
    `<th ${th}>Invoice</th>` +
    `<th ${th}>Details</th>` +
    `<th ${th}>Due Date</th>` +
    `<th ${thRight}>Amount</th>` +
    "</tr></thead>" +
    `<tbody>${body}</tbody>` +
    "<tfoot><tr>" +
    `<td colspan="3" style="padding:10px;text-align:right;font-weight:700;` +
    `font-size:14px;color:#111827;border-top:2px solid #d1d5db;">${totalLabel}</td>` +
    `<td style="padding:10px;text-align:right;font-weight:700;font-size:14px;` +
    `color:#111827;border-top:2px solid #d1d5db;">${esc(totalCell)}</td>` +
    "</tr></tfoot>" +
    "</table>"
  );
}

/** Extra merge values for a consolidated email: {{total}}, {{invoice_table}}
 *  and {{count}}. Customer-level fields ({{name}}, {{currency}}) come from the
 *  group's first row at the call site. */
export function consolidatedExtras(rows: Recipient[]): {
  total: string;
  invoice_table: string;
  count: string;
} {
  return {
    total: formatAmount(sumAmounts(rows)),
    invoice_table: buildInvoiceTableHtml(rows),
    count: String(rows.length),
  };
}
