/* Bank ledger reconciliation — Architecture §8.5.
   Downloads the uploaded bank statement(s) + books ledger(s) (+ optional
   Razorpay settlement report(s)), merges each side into one dataset, runs the
   multi-pass matcher, and writes the BankReconcileResult back to the jobs row
   via runJob. Each side may receive several files (e.g. monthly statements);
   they are parsed independently and concatenated, with each row keeping its
   source filename. */

import { logger, task } from "@trigger.dev/sdk";
import { runJob } from "../../../core/lib/job-runner";
import { downloadSupabaseUploadNamed } from "../../../core/lib/supabase-uploads";
import { STORAGE_BUCKETS } from "../../../core/lib/storage-buckets";
import { parseBankStatement, parseBooksLedger, mergeTxns, checkRunningBalance } from "../lib/parse";
import { parseSettlementReport } from "../lib/settlement";
import { reconcile } from "../lib/match";
import { DEFAULT_OPTIONS } from "../lib/types";
import type { ReconcileOptions, SettlementRow, FileSource } from "../lib/types";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  bankUploadIds: string[];
  booksUploadIds: string[];
  settlementUploadIds?: string[];
  options?: Partial<ReconcileOptions>;
};

const BUCKET = STORAGE_BUCKETS.ledgerUploads;

async function fetchNamed(uploadId: string, label: string): Promise<{ filename: string; buffer: Buffer }> {
  const got = await downloadSupabaseUploadNamed(`supabase:${uploadId}`, BUCKET);
  if (!got) throw new Error(`could not download ${label} (upload ${uploadId})`);
  return got;
}

/** Warn when later files map a key column differently from the first file. */
function columnNotes(
  label: string,
  filenames: string[],
  columns: Array<Record<string, string | null>>,
): string[] {
  if (columns.length < 2) return [];
  const base = columns[0];
  const keys = ["date", "debit", "credit", "amount"];
  const out: string[] = [];
  for (let i = 1; i < columns.length; i++) {
    const diff = keys.filter((k) => (columns[i][k] ?? null) !== (base[k] ?? null));
    if (diff.length) {
      out.push(
        `${filenames[i]} ${label} column mapping differs from ${filenames[0]} (${diff.join(", ")}) — parsed independently.`,
      );
    }
  }
  return out;
}

export const bankReconcile = task({
  id: "bank-ledger-reconcile",
  maxDuration: 1800,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      const opts: ReconcileOptions = { ...DEFAULT_OPTIONS, ...(p.options ?? {}) };
      logger.info("starting bank reconciliation", {
        jobId: p.jobId,
        bankFiles: p.bankUploadIds.length,
        booksFiles: p.booksUploadIds.length,
        settlementFiles: p.settlementUploadIds?.length ?? 0,
        opts,
      });

      // ── Download every file on each side ────────────────────────────────
      const [bankFiles, booksFiles] = await Promise.all([
        Promise.all(p.bankUploadIds.map((id) => fetchNamed(id, "bank statement"))),
        Promise.all(p.booksUploadIds.map((id) => fetchNamed(id, "books ledger"))),
      ]);

      // ── Parse each file, then merge into one dataset per side ───────────
      const [bankParsed, booksParsed] = await Promise.all([
        Promise.all(bankFiles.map((f) => parseBankStatement(f.buffer))),
        Promise.all(booksFiles.map((f) => parseBooksLedger(f.buffer))),
      ]);

      const bankMerge = mergeTxns(
        bankParsed.map((parsed, i) => ({ file: bankFiles[i].filename, txns: parsed.txns })),
        (t) => t.date,
      );
      const booksMerge = mergeTxns(
        booksParsed.map((parsed, i) => ({ file: booksFiles[i].filename, txns: parsed.txns })),
        (t) => t.date,
      );

      // ── Optional Razorpay settlement report(s) ──────────────────────────
      let settlementMerge: { merged: SettlementRow[]; sources: FileSource[]; notes: string[] } | null = null;
      const settlementIds = p.settlementUploadIds ?? [];
      if (settlementIds.length) {
        const sFiles = await Promise.all(settlementIds.map((id) => fetchNamed(id, "settlement report")));
        const sParsed = sFiles.map((f) => parseSettlementReport(f.buffer));
        settlementMerge = mergeTxns(
          sParsed.map((parsed, i) => ({ file: sFiles[i].filename, txns: parsed.rows })),
          (s) => s.settledAt,
        );
      }

      const result = reconcile(
        bankMerge.merged,
        booksMerge.merged,
        opts,
        settlementMerge?.merged ?? [],
        { bankColumns: bankParsed[0].columns, booksColumns: booksParsed[0].columns },
      );

      // Per-file running-balance tie-out: catches a row misread/dropped/duplicated
      // during parsing (esp. the PDF path) before the gap is trusted. Run per file
      // — balance continuity only holds within one statement, not across the merge.
      const balanceNotes = [
        ...bankParsed.map((p, i) => checkRunningBalance(p.txns, bankFiles[i].filename)),
        ...booksParsed.map((p, i) => checkRunningBalance(p.txns, booksFiles[i].filename)),
      ].filter((n): n is string => n !== null);

      const extraNotes = [
        ...balanceNotes,
        ...bankMerge.notes,
        ...booksMerge.notes,
        ...(settlementMerge?.notes ?? []),
        ...columnNotes("bank statement", bankFiles.map((f) => f.filename), bankParsed.map((x) => x.columns)),
        ...columnNotes("books ledger", booksFiles.map((f) => f.filename), booksParsed.map((x) => x.columns)),
      ];

      logger.info("bank reconciliation done", {
        jobId: p.jobId,
        bankRows: bankMerge.merged.length,
        booksRows: booksMerge.merged.length,
        groups: result.summary.matchedGroups,
        unmatchedBank: result.summary.unmatchedBankCount,
        unmatchedBooks: result.summary.unmatchedBooksCount,
        netGap: result.summary.netGap,
      });

      return {
        ...result,
        notes: [...result.notes, ...extraNotes],
        sources: {
          bank: bankMerge.sources,
          books: booksMerge.sources,
          settlement: settlementMerge?.sources ?? [],
        },
      };
    }),
});
