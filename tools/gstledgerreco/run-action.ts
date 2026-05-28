"use server";

/* Server action — start a GST reconciliation run.
   Mirrors bankledgerreco/run-action.ts: the client uploads files first
   (POST /api/uploads), then this action takes a FormData of upload IDs,
   creates an RLS-scoped jobs row, and hands the heavy work to
   the Trigger.dev task. The browser polls Supabase for status — never
   Trigger.dev directly. */

import { redirect } from "next/navigation";
import { tasks } from "@trigger.dev/sdk";
import { supabaseServer } from "../../core/lib/supabase-server";
import { getToolId } from "../../core/lib/tools";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import { DEFAULT_OPTIONS } from "./lib/types";
import type { gstReconcile } from "./jobs/reconcile";

/** Pull repeated FormData fields into a de-duplicated id list. */
function ids(formData: FormData, key: string): string[] {
  const seen = new Set<string>();
  for (const v of formData.getAll(key)) {
    const id = String(v ?? "").trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

export async function runGstReconcileAction(formData: FormData) {
  const gstr1UploadIds = ids(formData, "gstr1UploadId");
  const gstr2aUploadIds = ids(formData, "gstr2aUploadId");
  const gstr2bUploadIds = ids(formData, "gstr2bUploadId");
  const salesUploadIds = ids(formData, "salesUploadId");
  const purchaseUploadIds = ids(formData, "purchaseUploadId");

  // ITC reco needs at least 2B + Purchase Register. Everything else is optional.
  if (!gstr2bUploadIds.length || !purchaseUploadIds.length) {
    throw new Error("At least one GSTR-2B file and one Purchase Register are required.");
  }

  const num = (k: string, fallback: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const options = {
    dateWindowDays: num("dateWindowDays", DEFAULT_OPTIONS.dateWindowDays),
    amountTolerancePaise: num("amountTolerancePaise", DEFAULT_OPTIONS.amountTolerancePaise),
  };

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginHrefWithReturn());

  const toolId = await getToolId(supabase, "gstledgerreco");
  if (!toolId) throw new Error("tools lookup failed for slug=gstledgerreco");

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      tool_id: toolId,
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
    toolId,
    gstr1UploadIds: gstr1UploadIds.length ? gstr1UploadIds : undefined,
    gstr2aUploadIds: gstr2aUploadIds.length ? gstr2aUploadIds : undefined,
    gstr2bUploadIds,
    salesUploadIds: salesUploadIds.length ? salesUploadIds : undefined,
    purchaseUploadIds,
    options,
  });

  redirect(`/tools/gstledgerreco?jobId=${job.id}`);
}
