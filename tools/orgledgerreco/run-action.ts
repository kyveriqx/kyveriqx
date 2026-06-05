"use server";

/* Server action — start an inter-entity ledger reconciliation.
   Architecture §1, §8.5: insert an RLS-scoped queued job row and hand the heavy
   work to the Trigger.dev task; the browser polls Supabase for status. The
   client uploads the files first (POST /api/uploads) and submits the resulting
   upload ids here (one or more per side), mirroring the bankledgerreco flow.

   Moved from the old inline pipeline to support multi-file + PDF parsing and the
   (Phase 2) AI fallback, which can exceed an inline request's budget. */

import { redirect } from "next/navigation";
import { tasks } from "@trigger.dev/sdk";
import { supabaseServer } from "../../core/lib/supabase-server";
import { getToolId } from "../../core/lib/tools";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import type { orgReconcile } from "./jobs/reconcile";

/** Pull a repeated FormData field into a clean, de-duplicated id list. */
function ids(formData: FormData, key: string): string[] {
  const seen = new Set<string>();
  for (const v of formData.getAll(key)) {
    const id = String(v ?? "").trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

export async function runOrgReconcileAction(formData: FormData) {
  const companyUploadIds = ids(formData, "companyUploadId");
  const partnerUploadIds = ids(formData, "partnerUploadId");
  if (!companyUploadIds.length || !partnerUploadIds.length) {
    throw new Error("At least one company ledger and one partner ledger are required.");
  }

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginHrefWithReturn());

  const toolId = await getToolId(supabase, "orgledgerreco");
  if (!toolId) throw new Error("tools lookup failed for slug=orgledgerreco");

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      tool_id: toolId,
      job_key: "org-ledger-reconcile",
      status: "queued",
      payload: {},
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`failed to create job: ${jobErr?.message}`);

  await tasks.trigger<typeof orgReconcile>("org-ledger-reconcile", {
    jobId: job.id,
    userId: user.id,
    toolId,
    companyUploadIds,
    partnerUploadIds,
  });

  redirect(`/tools/orgledgerreco?jobId=${job.id}`);
}
