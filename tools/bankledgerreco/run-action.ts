"use server";

/* Server action — start a bank reconciliation run.
   Architecture §1, §8.5: the app inserts an RLS-scoped job row and hands
   the heavy work to a Trigger.dev task; the browser polls Supabase for
   status. The client uploads the files first (POST /api/uploads) and passes
   the resulting upload ids here. */

import { tasks } from "@trigger.dev/sdk";
import { supabaseServer } from "../../core/lib/supabase-server";
import { getToolId } from "../../core/lib/tools";
import type { ReconcileOptions } from "./lib/types";
import type { bankReconcile } from "./jobs/reconcile";

export async function runBankReconcileAction(input: {
  bankUploadId: string;
  booksUploadId: string;
  settlementUploadId?: string;
  options?: Partial<ReconcileOptions>;
}): Promise<{ jobId: string }> {
  const bankUploadId = input.bankUploadId?.trim();
  const booksUploadId = input.booksUploadId?.trim();
  const settlementUploadId = input.settlementUploadId?.trim() || undefined;
  if (!bankUploadId || !booksUploadId) {
    throw new Error("Both a bank statement and a books ledger are required.");
  }

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in to run a reconciliation.");

  const toolId = await getToolId(supabase, "bankledgerreco");
  if (!toolId) throw new Error("tools lookup failed: no bankledgerreco row");

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      tool_id: toolId,
      job_key: "bank-ledger-reconcile",
      status: "queued",
      payload: {},
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`failed to create job: ${jobErr?.message}`);

  await tasks.trigger<typeof bankReconcile>("bank-ledger-reconcile", {
    jobId: job.id,
    userId: user.id,
    toolId,
    bankUploadId,
    booksUploadId,
    settlementUploadId,
    options: input.options,
  });

  return { jobId: job.id };
}
