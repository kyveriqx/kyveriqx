/* Owner approval gate for the Customer Payment Reminder tool.

   Payment reminders go out from the customer's own mailbox, so the same
   anti-abuse / sender-reputation gate as Email Campaigns applies. Approval is
   SHARED with Email Campaigns: both tools read and write the single
   emailcampaign_approvals row, so a customer approved to send email campaigns
   is instantly approved here too (and vice versa). Admins are treated as
   approved so the owner can test without approving themselves. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdmin } from "../../../core/lib/admin";

export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";

/** Resolve the (shared) sender-approval state for a user.
 *  - admins → always "approved" (so the owner is never gated when testing)
 *  - otherwise the stored row's status, or "none" if they've never requested. */
export async function paymentReminderApproval(
  supabase: SupabaseClient,
  userId: string,
): Promise<ApprovalStatus> {
  if (await isAdmin(supabase, userId)) return "approved";

  const { data } = await supabase
    .from("emailcampaign_approvals")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  const s = (data?.status as string | undefined) ?? null;
  if (s === "pending" || s === "approved" || s === "rejected") return s;
  return "none";
}
