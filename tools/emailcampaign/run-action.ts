"use server";

/* Server action — start an email campaign run.

   Mirrors tools/bankledgerreco/run-action.ts: the browser uploads the
   recipient file to /api/uploads first, then submits the upload ID
   plus subject + body here. We insert an RLS-scoped jobs row, trigger
   the Trigger.dev task, and redirect to ?jobId for the result view to
   poll. */

import { redirect } from "next/navigation";
import { tasks } from "@trigger.dev/sdk";
import { supabaseServer } from "../../core/lib/supabase-server";
import { getToolId } from "../../core/lib/tools";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import type { sendEmailCampaign } from "./jobs/send-campaign";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function runEmailCampaignAction(formData: FormData) {
  const recipientsUploadId = str(formData, "recipientsUploadId");
  const subject = str(formData, "subject");
  const body = String(formData.get("body") ?? ""); // preserve HTML whitespace

  if (!recipientsUploadId) throw new Error("Please upload a recipient list before sending.");
  if (!subject) throw new Error("Subject is required.");
  if (!body.trim()) throw new Error("Email body is required.");

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginHrefWithReturn());

  // The campaign can only run if the user has saved SMTP credentials —
  // surface that early instead of failing inside the Trigger.dev task.
  const { data: creds } = await supabase
    .from("user_smtp_credentials")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!creds) {
    throw new Error("Please save your SMTP credentials before sending a campaign.");
  }

  const toolId = await getToolId(supabase, "emailcampaign");
  if (!toolId) throw new Error("tools lookup failed for slug=emailcampaign");

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      tool_id: toolId,
      job_key: "send-email-campaign",
      status: "queued",
      payload: {},
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`failed to create job: ${jobErr?.message}`);

  await tasks.trigger<typeof sendEmailCampaign>("send-email-campaign", {
    jobId: job.id,
    userId: user.id,
    toolId,
    recipientsUploadId,
    subject,
    body,
  });

  redirect(`/tools/emailcampaign?jobId=${job.id}`);
}
