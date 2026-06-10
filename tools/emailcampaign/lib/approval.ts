/* Owner approval gate for the email campaign tool.

   A customer must be approved before they can connect a mailbox or send. This
   resolves the caller's approval state for the page gate. Admins are treated as
   approved so the owner can test without approving themselves. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdmin } from "../../../core/lib/admin";

export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";

/** Resolve the email-campaign approval state for a user.
 *  - admins → always "approved" (so the owner is never gated when testing)
 *  - otherwise the stored row's status, or "none" if they've never requested. */
export async function emailCampaignApproval(
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
