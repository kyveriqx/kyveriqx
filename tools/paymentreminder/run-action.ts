"use server";

/* Server action — start a payment-reminder run.

   Mirrors tools/emailcampaign/run-action.ts: the browser uploads the
   customer file to /api/uploads first, then submits the upload ID plus
   subject + body here. We insert an RLS-scoped jobs row, trigger the
   Trigger.dev task, and redirect to ?jobId for the result view to poll. */

import { redirect } from "next/navigation";
import { tasks } from "@trigger.dev/sdk";
import { supabaseServer } from "../../core/lib/supabase-server";
import { getToolId } from "../../core/lib/tools";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import type { sendPaymentReminder } from "./jobs/send-reminder";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function runPaymentReminderAction(formData: FormData) {
  const recipientsUploadId = str(formData, "recipientsUploadId");
  const subject = str(formData, "subject");
  const body = String(formData.get("body") ?? ""); // preserve HTML whitespace

  if (!recipientsUploadId) throw new Error("Please upload a customer list before sending.");
  if (!subject) throw new Error("Subject is required.");
  if (!body.trim()) throw new Error("Reminder body is required.");

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginHrefWithReturn());

  // The reminder can only run if the user has connected a mailbox — either via
  // OAuth (Microsoft) or a custom SMTP server. Surface that early instead of
  // failing inside the Trigger.dev task.
  const [{ data: smtp }, { data: oauth }] = await Promise.all([
    supabase.from("user_smtp_credentials").select("user_id").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_mail_oauth").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (!smtp && !oauth) {
    throw new Error("Please connect a mailbox before sending reminders.");
  }

  const toolId = await getToolId(supabase, "paymentreminder");
  if (!toolId) throw new Error("tools lookup failed for slug=paymentreminder");

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      user_id: user.id,
      tool_id: toolId,
      job_key: "send-payment-reminder",
      status: "queued",
      payload: {},
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`failed to create job: ${jobErr?.message}`);

  await tasks.trigger<typeof sendPaymentReminder>("send-payment-reminder", {
    jobId: job.id,
    userId: user.id,
    toolId,
    recipientsUploadId,
    subject,
    body,
  });

  redirect(`/tools/paymentreminder?jobId=${job.id}`);
}
