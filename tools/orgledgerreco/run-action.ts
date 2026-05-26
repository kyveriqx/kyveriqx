"use server";

/* Server action — start an inter-entity ledger reconciliation run.
   Architecture §1, §8.5: app inserts a job row (RLS-scoped to the user)
   and hands the heavy work to a Trigger.dev task; the browser polls
   Supabase for status, never Trigger.dev directly. */

import { redirect } from "next/navigation";
import { tasks } from "@trigger.dev/sdk";
import { supabaseServer } from "../../core/lib/supabase-server";
import type { orgReconcile } from "./jobs/reconcile";

export async function runOrgReconcileAction(formData: FormData) {
  const companyUploadId = String(formData.get("companyUploadId") ?? "");
  const partnerUploadId = String(formData.get("partnerUploadId") ?? "");
  if (!companyUploadId || !partnerUploadId) {
    throw new Error("Both files must be uploaded before running.");
  }

  const supabase = supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: tool, error: toolErr } = await supabase
    .from("tools")
    .select("id")
    .eq("slug", "orgledgerreco")
    .maybeSingle();
  if (toolErr || !tool) throw new Error(`tools lookup failed: ${toolErr?.message ?? "no row"}`);

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      tool_id: tool.id,
      job_key: "org-ledger-reconcile",
      status: "queued",
      payload: { companyUploadId, partnerUploadId },
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`failed to create job: ${jobErr?.message}`);

  await tasks.trigger<typeof orgReconcile>("org-ledger-reconcile", {
    jobId: job.id,
    userId: user.id,
    toolId: tool.id,
    companyUploadId,
    partnerUploadId,
  });

  redirect(`/tools/orgledgerreco?jobId=${job.id}`);
}
