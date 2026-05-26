/* Org / inter-entity ledger reconciliation — Architecture §8.5.

   Real implementation: pulls two uploaded files from Supabase Storage,
   parses each (your company's books, your business partner's multi-location
   ledger), runs the reconcile() matcher, returns the full result for the
   UI to render inline and for the download route to re-style into Excel. */

import { logger, task } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { runJob } from "../../../core/lib/job-runner";
import { parseCompanyLedger } from "../../../core/lib/ledger/parse-company";
import { parsePartnerLedger } from "../../../core/lib/ledger/parse-partner";
import { reconcile } from "../../../core/lib/ledger/match-ledgers";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  companyUploadId: string;
  partnerUploadId: string;
};

const supa = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

async function downloadUpload(uploadId: string): Promise<{ buffer: Buffer; filename: string }> {
  const s = supa();
  const { data: row, error } = await s
    .from("uploads")
    .select("storage_path, filename")
    .eq("id", uploadId)
    .single();
  if (error || !row) throw new Error(`upload ${uploadId} not found: ${error?.message ?? "no row"}`);

  const { data: blob, error: dlErr } = await s.storage
    .from("ledger-uploads")
    .download(row.storage_path);
  if (dlErr || !blob) throw new Error(`download failed for ${row.storage_path}: ${dlErr?.message}`);

  const ab = await blob.arrayBuffer();
  return { buffer: Buffer.from(ab), filename: row.filename };
}

export const orgReconcile = task({
  id: "org-ledger-reconcile",
  maxDuration: 1800,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      logger.info("starting org reconciliation", {
        jobId: p.jobId,
        companyUploadId: p.companyUploadId,
        partnerUploadId: p.partnerUploadId,
      });
      const start = Date.now();

      const [companyFile, partnerFile] = await Promise.all([
        downloadUpload(p.companyUploadId),
        downloadUpload(p.partnerUploadId),
      ]);
      logger.info("downloaded files", {
        company: companyFile.filename,
        partner: partnerFile.filename,
      });

      const company = parseCompanyLedger(companyFile.buffer);
      const partner = parsePartnerLedger(partnerFile.buffer);
      logger.info("parsed ledgers", {
        companyTxns: company.transactions.length,
        partnerLocations: partner.locations.length,
      });

      const result = reconcile(company, partner);

      return {
        ...result,
        durationMs: Date.now() - start,
        sourceFiles: {
          company: companyFile.filename,
          partner: partnerFile.filename,
        },
      };
    }),
});
