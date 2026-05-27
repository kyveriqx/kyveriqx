"use server";

/* Server action — start a bank reconciliation run.
   Architecture §1, §8.5: the app inserts an RLS-scoped job row and hands the
   heavy work to a Trigger.dev task; the browser polls Supabase for status.
   The client uploads the files first (POST /api/uploads) and submits the
   resulting upload ids here, mirroring the orgledgerreco flow (FormData in,
   redirect to ?jobId out). */

import { redirect } from "next/navigation";
import { tasks } from "@trigger.dev/sdk";
import { supabaseServer } from "../../core/lib/supabase-server";
import { getToolId } from "../../core/lib/tools";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import { DEFAULT_OPTIONS } from "./lib/types";
import type { bankReconcile } from "./jobs/reconcile";

/** Pull a repeated FormData field into a clean, de-duplicated id list. */
function ids(formData: FormData, key: string): string[] {
  const seen = new Set<string>();
  for (const v of formData.getAll(key)) {
    const id = String(v ?? "").trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

export async function runBankReconcileAction(formData: FormData) {
  const bankUploadIds = ids(formData, "bankUploadId");
  const booksUploadIds = ids(formData, "booksUploadId");
  const settlementUploadIds = ids(formData, "settlementUploadId");
  if (!bankUploadIds.length || !booksUploadIds.length) {
    throw new Error("At least one bank statement and one books ledger are required.");
  }

  const num = (k: string, fallback: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const options = {
    dateWindowDays: num("dateWindowDays", DEFAULT_OPTIONS.dateWindowDays),
    feeCeilingPct: num("feeCeilingPct", DEFAULT_OPTIONS.feeCeilingPct),
  };

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginHrefWithReturn());

  const toolId = await getToolId(supabase, "bankledgerreco");
  if (!toolId) throw new Error("tools lookup failed for slug=bankledgerreco");

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
    bankUploadIds,
    booksUploadIds,
    settlementUploadIds: settlementUploadIds.length ? settlementUploadIds : undefined,
    options,
  });

  redirect(`/tools/bankledgerreco?jobId=${job.id}`);
}
