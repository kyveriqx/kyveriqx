"use server";

/* Admin control actions. Every action re-checks admin (requireAdmin) and
   mutates through the service role (supabaseAdmin) so it can write across
   users — RLS would otherwise scope writes to the admin's own rows. After a
   mutation we revalidate the admin pages so the tables reflect the change. */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../core/lib/admin";
import { supabaseAdmin } from "../../core/lib/supabase";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Grant or extend a trial: pushes trial_ends_at out by `days` from the later
 *  of now / the current end, and (re)sets status to 'trial'. Upserts so it also
 *  works when the user has no subscription row for that tool yet. */
export async function extendTrial(
  userId: string,
  toolId: string,
  days: number,
): Promise<ActionResult> {
  await requireAdmin();
  if (!userId || !toolId || !Number.isFinite(days) || days <= 0) {
    return { ok: false, error: "Invalid input." };
  }
  const admin = supabaseAdmin();

  const { data: existing } = await admin
    .from("subscriptions")
    .select("trial_ends_at")
    .eq("user_id", userId)
    .eq("tool_id", toolId)
    .maybeSingle();

  const base = existing?.trial_ends_at
    ? Math.max(Date.now(), new Date(existing.trial_ends_at as string).getTime())
    : Date.now();
  const newEnd = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await admin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        tool_id: toolId,
        status: "trial",
        trial_ends_at: newEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,tool_id" },
    );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/users");
  revalidatePath("/admin/tools");
  return { ok: true };
}

/** Activate (mark paid) or cancel a subscription. Upserts for the same reason
 *  as extendTrial. */
export async function setSubscriptionStatus(
  userId: string,
  toolId: string,
  status: "active" | "cancelled" | "expired",
): Promise<ActionResult> {
  await requireAdmin();
  if (!userId || !toolId) return { ok: false, error: "Invalid input." };
  if (!["active", "cancelled", "expired"].includes(status)) {
    return { ok: false, error: "Invalid status." };
  }
  const admin = supabaseAdmin();

  const { error } = await admin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        tool_id: toolId,
        status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,tool_id" },
    );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/users");
  revalidatePath("/admin/tools");
  return { ok: true };
}

/** Soft-disable / re-enable a user (profiles.is_active, enforced in the tools
 *  layout). */
export async function setUserActive(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  if (!userId) return { ok: false, error: "Invalid input." };
  const admin = supabaseAdmin();

  const { error } = await admin
    .from("profiles")
    .update({ is_active: active })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/users");
  return { ok: true };
}

/** Approve or reject a customer's request to use the email campaign tool.
 *  Upserts so it also works if the admin is acting before any request row
 *  exists. Records who decided and when. */
export async function setEmailCampaignApproval(
  userId: string,
  approved: boolean,
  notes?: string,
): Promise<ActionResult> {
  const admin_user = await requireAdmin();
  if (!userId) return { ok: false, error: "Invalid input." };
  const admin = supabaseAdmin();

  const { error } = await admin
    .from("emailcampaign_approvals")
    .upsert(
      {
        user_id: userId,
        status: approved ? "approved" : "rejected",
        admin_notes: notes ?? null,
        decided_at: new Date().toISOString(),
        decided_by: admin_user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/approvals");
  return { ok: true };
}

/** Triage a feedback item: change its status and/or attach an admin note. */
export async function updateFeedback(
  id: string,
  patch: { status?: string; admin_notes?: string },
): Promise<ActionResult> {
  await requireAdmin();
  if (!id) return { ok: false, error: "Invalid input." };
  if (patch.status && !["open", "in_progress", "resolved", "closed"].includes(patch.status)) {
    return { ok: false, error: "Invalid status." };
  }
  const admin = supabaseAdmin();

  const { error } = await admin
    .from("feedback")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/feedback");
  return { ok: true };
}
