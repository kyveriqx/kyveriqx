/* Org Ledger Reconciliation pipeline (multi-file).

   Each side may receive several files in mixed formats: the partner's ledger
   commonly arrives as one file per location (Business Central Excel) plus older
   periods as Tally PDFs. This module:
     - classifies each file (PDF vs spreadsheet),
     - parses it with the right parser (control-total validated),
     - auto-detects each partner file's location + financial year,
     - de-duplicates identical statements (e.g. a re-sent PDF), and
     - bridges multiple periods of the same location into one cumulative position
       (an earlier period's closing should equal the next period's opening).

   The Trigger.dev task (tools/orgledgerreco/jobs/reconcile.ts) calls
   `reconcileFromFiles` and lets runJob persist the result. */

import { parseCompanyLedger } from "./parse-company";
import { parseCompanyPdf } from "./parse-company-pdf";
import { parsePartnerExcelFile } from "./parse-partner";
import { parsePartnerPdf } from "./parse-partner-pdf";
import { reconcile } from "./match-ledgers";
import type { CompanyLedger, PartnerLedger, PartnerLocation, ReconcileResult } from "./types";

export type NamedBuffer = { buffer: Buffer; filename: string };

function isPdf(f: NamedBuffer): boolean {
  if (/\.pdf$/i.test(f.filename)) return true;
  return f.buffer.subarray(0, 5).toString("latin1").startsWith("%PDF");
}

/** Sort key for a financial-year tag like "FY23-24" (earlier year first). */
function fyKey(period?: string): number {
  const m = period?.match(/FY(\d{2})/);
  return m ? Number(m[1]) : 99;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── company side ────────────────────────────────────────────────────────────

export async function parseCompanyFiles(
  files: NamedBuffer[],
): Promise<{ ledger: CompanyLedger; notes: string[] }> {
  if (!files.length) throw new Error("No company ledger file provided.");
  const notes: string[] = [];
  const parsed: CompanyLedger[] = [];
  for (const f of files) {
    try {
      if (isPdf(f)) {
        const { ledger, tiesOut } = await parseCompanyPdf(f.buffer, { source: f.filename });
        if (!tiesOut) {
          notes.push(
            `${f.filename}: parsed closing ₹${r2(ledger.closingRaw)} does not match the printed closing — please review.`,
          );
        }
        parsed.push(ledger);
      } else {
        parsed.push(parseCompanyLedger(f.buffer));
      }
    } catch (err) {
      // One unreadable file must not sink the whole job: if another company
      // file parses, skip this one with a named note. A common cause is the
      // partner's own ledger being dropped on the company side.
      void err;
      notes.push(
        `Skipped “${f.filename}” — it doesn't look like your company's ledger ` +
        `(no readable Date / Document No columns). If this is your business ` +
        `partner's ledger, upload it on the partner side instead.`,
      );
    }
  }
  if (parsed.length === 0) {
    // Nothing on the company side parsed — surface the original guidance.
    throw new Error(
      "Could not read Your Company's Ledger — please check the file format. " +
      "The file must contain a header row with 'Date' and 'Document No'.",
    );
  }
  if (parsed.length === 1) return { ledger: parsed[0], notes };

  // Merge several company exports: concatenate transactions, take the closing
  // from the ledger whose latest transaction date is most recent (cumulative).
  const maxDate = (c: CompanyLedger) =>
    c.transactions.reduce((m, t) => (t.date && (!m || t.date > m) ? t.date : m), null as Date | null);
  const latest = [...parsed].sort((a, b) => (maxDate(b)?.getTime() ?? 0) - (maxDate(a)?.getTime() ?? 0))[0];
  const earliest = [...parsed].sort((a, b) => (maxDate(a)?.getTime() ?? 0) - (maxDate(b)?.getTime() ?? 0))[0];
  return {
    ledger: {
      ...latest,
      openingBal: earliest.openingBal,
      transactions: parsed.flatMap((c) => c.transactions),
    },
    notes,
  };
}

// ── partner side ──────────────────────────────────────────────────────────

export async function parsePartnerFiles(
  files: NamedBuffer[],
): Promise<PartnerLedger> {
  const notes: string[] = [];
  const all: PartnerLocation[] = [];

  for (const f of files) {
    if (isPdf(f)) {
      const { location, tiesOut } = await parsePartnerPdf(f.buffer, { source: f.filename });
      if (!tiesOut) {
        notes.push(
          `${f.filename}: parsed closing ₹${r2(location.computedClosing ?? 0)} does not match the printed closing ₹${r2(location.printedClosing ?? 0)} — please review.`,
        );
      }
      all.push(location);
    } else {
      const locs = parsePartnerExcelFile(f.buffer, f.filename);
      for (const l of locs) {
        if (l.printedClosing != null && Math.abs((l.computedClosing ?? 0) - l.printedClosing) > 1) {
          notes.push(
            `${f.filename} (${l.location}): parsed closing ₹${r2(l.computedClosing ?? 0)} does not match the printed closing ₹${r2(l.printedClosing)} — please review.`,
          );
        }
      }
      all.push(...locs);
    }
  }

  // De-duplicate identical statements (same location, period, closing, size).
  const seen = new Set<string>();
  const unique: PartnerLocation[] = [];
  for (const l of all) {
    const key = `${l.location}|${l.transactions[0]?.period ?? ""}|${Math.round(l.computedClosing ?? 0)}|${l.transactions.length}`;
    if (seen.has(key)) {
      notes.push(`Duplicate ${l.location} statement (${(l.sources ?? []).join(", ")}) ignored.`);
      continue;
    }
    seen.add(key);
    unique.push(l);
  }

  // Group by location, then bridge multiple periods into one running position.
  const byLoc = new Map<string, PartnerLocation[]>();
  for (const l of unique) {
    const g = byLoc.get(l.location) ?? [];
    g.push(l);
    byLoc.set(l.location, g);
  }

  const merged: PartnerLocation[] = [];
  for (const [loc, group] of byLoc) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    group.sort((a, b) => fyKey(a.transactions[0]?.period) - fyKey(b.transactions[0]?.period));
    for (let i = 1; i < group.length; i++) {
      const prevClose = group[i - 1].closingBal;
      const nextOpen = group[i].openingBal;
      if (Math.abs(prevClose - nextOpen) > 1) {
        notes.push(
          `${loc}: ${(group[i - 1].sources ?? []).join(", ")} closing ₹${r2(prevClose)} ≠ ${(group[i].sources ?? []).join(", ")} opening ₹${r2(nextOpen)} — period bridge gap.`,
        );
      }
    }
    const txns = group.flatMap((g) => g.transactions);
    merged.push({
      location: loc,
      partyName: group[0].partyName,
      openingBal: group[0].openingBal,
      closingBal: group[group.length - 1].closingBal, // latest period carries forward
      transactions: txns,
      format: group.some((g) => g.format === "pdf") ? "pdf" : "excel",
      printedClosing: group[group.length - 1].printedClosing,
      computedClosing: group[0].openingBal + txns.reduce((s, t) => s + t.amount, 0),
      sources: group.flatMap((g) => g.sources ?? []),
    });
  }

  const totalClosing = merged.reduce((s, l) => s + l.closingBal, 0);
  return { locations: merged, totalClosing, notes };
}

// ── full pipeline ─────────────────────────────────────────────────────────

export type OrgReconcileOutput = ReconcileResult & {
  durationMs: number;
  notes: string[];
  sources: { company: string[]; partner: string[] };
};

export async function reconcileFromFiles(
  companyFiles: NamedBuffer[],
  partnerFiles: NamedBuffer[],
): Promise<OrgReconcileOutput> {
  const start = Date.now();
  const company = await parseCompanyFiles(companyFiles);
  const partner = await parsePartnerFiles(partnerFiles);
  const result = reconcile(company.ledger, partner);
  return {
    ...result,
    durationMs: Date.now() - start,
    notes: [...company.notes, ...(partner.notes ?? [])],
    sources: {
      company: companyFiles.map((f) => f.filename),
      partner: partnerFiles.map((f) => f.filename),
    },
  };
}
