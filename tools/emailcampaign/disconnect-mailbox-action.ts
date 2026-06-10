"use server";

/* Disconnect a connected OAuth mailbox (e.g. Microsoft) by deleting the
   user's row in user_mail_oauth. The encrypted refresh token goes with it,
   so nothing can send on their behalf afterwards. Returns an error string
   instead of throwing — Next.js masks thrown server-action errors in
   production, so the card reads the return value to show a real message. */

import { revalidatePath } from "next/cache";
import { supabaseServer } from "../../core/lib/supabase-server";

export async function disconnectMailboxAction(): Promise<{ error?: string }> {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };

  const { error } = await supabase
    .from("user_mail_oauth")
    .delete()
    .eq("user_id", user.id);
  if (error) return { error: `Could not disconnect: ${error.message}` };

  revalidatePath("/tools/emailcampaign");
  return {};
}
