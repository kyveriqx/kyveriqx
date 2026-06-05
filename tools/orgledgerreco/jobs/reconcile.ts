/* Org ledger reconciliation — Architecture §8.5.
   Downloads the company ledger file(s) + the business partner's ledger file(s)
   (Business Central Excel and/or Tally PDF, one location per file), runs the
   multi-file pipeline (parse → auto-detect location/period → bridge periods →
   match), and writes the ReconcileResult back to the jobs row via runJob.

   Moved off the old inline path so PDF parsing and the (Phase 2) AI fallback can
   run in the worker without blocking the request. */

import { logger, task } from "@trigger.dev/sdk";
import { runJob } from "../../../core/lib/job-runner";
import { downloadSupabaseUploadNamed } from "../../../core/lib/supabase-uploads";
import { STORAGE_BUCKETS } from "../../../core/lib/storage-buckets";
import { reconcileFromFiles, type NamedBuffer } from "../../../core/lib/ledger/run-pipeline";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  companyUploadIds: string[];
  partnerUploadIds: string[];
};

const BUCKET = STORAGE_BUCKETS.ledgerUploads;

async function fetchNamed(uploadId: string, label: string): Promise<NamedBuffer> {
  const got = await downloadSupabaseUploadNamed(`supabase:${uploadId}`, BUCKET);
  if (!got) throw new Error(`could not download ${label} (upload ${uploadId})`);
  return got;
}

export const orgReconcile = task({
  id: "org-ledger-reconcile",
  maxDuration: 1800,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      logger.info("starting org reconciliation", {
        jobId: p.jobId,
        companyFiles: p.companyUploadIds.length,
        partnerFiles: p.partnerUploadIds.length,
      });

      const [companyFiles, partnerFiles] = await Promise.all([
        Promise.all(p.companyUploadIds.map((id) => fetchNamed(id, "company ledger"))),
        Promise.all(p.partnerUploadIds.map((id) => fetchNamed(id, "partner ledger"))),
      ]);

      const result = await reconcileFromFiles(companyFiles, partnerFiles);

      logger.info("org reconciliation done", {
        jobId: p.jobId,
        companyClosing: result.companyClosing,
        partnerClosing: result.partnerClosing,
        totalGap: result.totalGap,
        locations: result.locationSummary.length,
        notes: result.notes.length,
      });

      return result;
    }),
});
