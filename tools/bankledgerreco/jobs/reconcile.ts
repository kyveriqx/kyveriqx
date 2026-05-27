/* Bank ledger reconciliation — Architecture §8.5.
   Downloads the uploaded bank statement + books ledger (+ optional Razorpay
   settlement report), runs the multi-pass matcher, and writes the
   BankReconcileResult back to the jobs row via runJob. */

import { logger, task } from "@trigger.dev/sdk";
import { runJob } from "../../../core/lib/job-runner";
import { downloadSupabaseUpload } from "../../../core/lib/supabase-uploads";
import { STORAGE_BUCKETS } from "../../../core/lib/storage-buckets";
import { parseBankStatement, parseBooksLedger } from "../lib/parse";
import { parseSettlementReport } from "../lib/settlement";
import { reconcile } from "../lib/match";
import { DEFAULT_OPTIONS } from "../lib/types";
import type { ReconcileOptions } from "../lib/types";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  bankUploadId: string;
  booksUploadId: string;
  settlementUploadId?: string;
  options?: Partial<ReconcileOptions>;
};

const BUCKET = STORAGE_BUCKETS.ledgerUploads;

async function need(uploadId: string, label: string): Promise<Buffer> {
  const buf = await downloadSupabaseUpload(`supabase:${uploadId}`, BUCKET);
  if (!buf) throw new Error(`could not download ${label} (upload ${uploadId})`);
  return buf;
}

export const bankReconcile = task({
  id: "bank-ledger-reconcile",
  maxDuration: 1800,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      const opts: ReconcileOptions = { ...DEFAULT_OPTIONS, ...(p.options ?? {}) };
      logger.info("starting bank reconciliation", {
        jobId: p.jobId,
        hasSettlement: Boolean(p.settlementUploadId),
        opts,
      });

      const [bankBuf, booksBuf] = await Promise.all([
        need(p.bankUploadId, "bank statement"),
        need(p.booksUploadId, "books ledger"),
      ]);

      const bank = parseBankStatement(bankBuf);
      const books = parseBooksLedger(booksBuf);

      let settlement: ReturnType<typeof parseSettlementReport> | null = null;
      if (p.settlementUploadId) {
        const sbuf = await need(p.settlementUploadId, "settlement report");
        settlement = parseSettlementReport(sbuf);
      }

      const result = reconcile(
        bank.txns,
        books.txns,
        opts,
        settlement?.rows ?? [],
        { bankColumns: bank.columns, booksColumns: books.columns },
      );

      logger.info("bank reconciliation done", {
        jobId: p.jobId,
        bankRows: bank.txns.length,
        booksRows: books.txns.length,
        groups: result.summary.matchedGroups,
        unmatchedBank: result.summary.unmatchedBankCount,
        unmatchedBooks: result.summary.unmatchedBooksCount,
        netGap: result.summary.netGap,
      });

      return result;
    }),
});
