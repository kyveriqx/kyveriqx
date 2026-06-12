"use server";

/* Customer asks for access to send reminders. Inserts (or re-arms) a
   'pending' row in emailcampaign_approvals via the user's own session — RLS
   only lets them write their own row, and only as 'pending', so they can't
   self-approve. The owner then approves it in /admin/approvals.

   Approval is SHARED with Email Campaigns (same table / same row), so a
   customer only ever requests sender access once.

   Returns `{ error }` instead of throwing (Next.js masks thrown server-action
   errors in production); the gate reads the return value. */

import { revalidatePath } from "next/cache";
import { supabaseServer } from "../../core/lib/supabase-server";

export async function requestPaymentReminderAccessAction(): Promise<{ error?: string }> {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };

  // Re-requesting after a rejection resets to 'pending'. onConflict on the
  // primary key keeps it one row per user.
  const { error } = await supabase.from("emailcampaign_approvals").upsert(
    {
      user_id: user.id,
      status: "pending",
      requested_at: new Date().toISOString(),
      decided_at: null,
      decided_by: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { error: `Could not send your request: ${error.message}` };

  revalidatePath("/tools/paymentreminder");
  return {};
}
