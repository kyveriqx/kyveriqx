/* Inline reconciliation pipeline for the Org Ledger Reconciliation tool.

   Replaces the Trigger.dev queue path for this specific tool — the
   matcher runs in ~500ms so the orchestration overhead (queue + cold
   start + worker handoff + polling) cost more than the work. Server
   action calls this directly inside the Next.js request, then redirects
   to the result page.

   Always writes a jobs row before returning, in either succeeded or
   failed state, so the result page has something to render and the
   /api/jobs/[id]/report download keeps working. */

import { supabaseAdmin } from "../supabase";
import { parseCompanyLedger } from "./parse-company";
import { parsePartnerLedger } from "./parse-partner";
import { reconcile } from "./match-ledgers";

type Opts = {
  companyUploadId: string;
  partnerUploadId: string;
  userId: string;
  toolId: string;
};

async function downloadUpload(uploadId: string): Promise<{ buffer: Buffer; filename: string }> {
  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from("uploads")
    .select("storage_path, filename")
    .eq("id", uploadId)
    .single();
  if (error || !row) throw new Error(`upload ${uploadId} not found: ${error?.message ?? "no row"}`);

  const { data: blob, error: dlErr } = await admin.storage
    .from("ledger-uploads")
    .download(row.storage_path);
  if (dlErr || !blob) throw new Error(`download failed for ${row.storage_path}: ${dlErr?.message}`);

  const ab = await blob.arrayBuffer();
  return { buffer: Buffer.from(ab), filename: row.filename };
}

export async function runReconciliationPipeline(opts: Opts): Promise<{ jobId: string }> {
  const admin = supabaseAdmin();
  const start = Date.now();

  let success: { result: object } | null = null;
  let errorMessage: string | null = null;

  try {
    const [companyFile, partnerFile] = await Promise.all([
      downloadUpload(opts.companyUploadId),
      downloadUpload(opts.partnerUploadId),
    ]);

    const company = parseCompanyLedger(companyFile.buffer);
    const partner = parsePartnerLedger(partnerFile.buffer);
    const result = reconcile(company, partner);

    success = {
      result: {
        ...result,
        durationMs: Date.now() - start,
        sourceFiles: {
          company: companyFile.filename,
          partner: partnerFile.filename,
        },
      },
    };
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const insert = success
    ? { status: "succeeded" as const, result: success.result, error: null }
    : { status: "failed" as const, result: null, error: errorMessage };

  const { data: job, error: jobErr } = await admin
    .from("jobs")
    .insert({
      user_id: opts.userId,
      tool_id: opts.toolId,
      job_key: "org-ledger-reconcile",
      payload: {
        companyUploadId: opts.companyUploadId,
        partnerUploadId: opts.partnerUploadId,
      },
      ...insert,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    throw new Error(`failed to write jobs row: ${jobErr?.message ?? "no row"}`);
  }

  return { jobId: job.id };
}
