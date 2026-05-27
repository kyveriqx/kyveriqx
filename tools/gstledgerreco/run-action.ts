"use server";

/* Server action — start a GST reconciliation run.
   Architecture §1, §8.5: app inserts a job row (RLS-scoped to the user)
   and hands the heavy work to a Trigger.dev task; the browser polls
   Supabase for status, never Trigger.dev directly. */

import { redirect } from "next/navigation";
import { tasks } from "@trigger.dev/sdk";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import type { gstReconcile } from "./jobs/reconcile";

export async function runGstReconcileAction() {
  const supabase = supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginHrefWithReturn());

  const { data: tool, error: toolErr } = await supabase
    .from("tools")
    .select("id")
    .eq("slug", "gstledgerreco")
    .maybeSingle();
  if (toolErr || !tool) throw new Error(`tools lookup failed: ${toolErr?.message ?? "no row"}`);

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      tool_id: tool.id,
      job_key: "gst-ledger-reconcile",
      status: "queued",
      payload: {},
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`failed to create job: ${jobErr?.message}`);

  await tasks.trigger<typeof gstReconcile>("gst-ledger-reconcile", {
    jobId: job.id,
    userId: user.id,
    toolId: tool.id,
    uploadIds: [],
  });

  redirect(`/?jobId=${job.id}`);
}
