/* Entitlement — does a user still have access to a tool? — Architecture §8.6.

   Access is computed from the subscriptions row, NOT stored as a flag, so it
   stays correct without any cron job flipping statuses:

     • status='active'                         → full access (paid)
     • status='trial' AND now < trial_ends_at  → trial access
     • status='trial' AND now >= trial_ends_at → LOCKED (trial elapsed)
     • status='expired' | 'cancelled'          → LOCKED
     • no subscription row / tool not billable → access (nothing to enforce)

   The 'trial elapsed' case is why we don't need a scheduled job: the moment
   trial_ends_at passes, effectiveStatus() reports 'expired' on the next read. */

import type { SupabaseClient } from "@supabase/supabase-js";

export type EffectiveStatus = "active" | "trial" | "expired" | "cancelled";

/** Resolve the stored status + trial date into what's true *right now*. */
export function effectiveStatus(
  status: string,
  trialEndsAt: string | null,
): EffectiveStatus {
  if (status === "trial") {
    const elapsed = trialEndsAt ? new Date(trialEndsAt).getTime() <= Date.now() : false;
    return elapsed ? "expired" : "trial";
  }
  if (status === "active" || status === "expired" || status === "cancelled") {
    return status;
  }
  return "expired"; // unknown status → fail closed
}

export function isLocked(status: EffectiveStatus): boolean {
  return status === "expired" || status === "cancelled";
}

export type ToolEntitlement = {
  /** Effective status, or 'none' when the tool isn't billed / has no row. */
  status: EffectiveStatus | "none";
  trialEndsAt: string | null;
  toolName: string | null;
  priceInr: number | null;
  locked: boolean;
};

/** Look up a user's entitlement for one tool slug. Two small reads, both
 *  allowed under RLS (tools is public-read; subs are user-scoped). */
export async function toolEntitlement(
  supabase: SupabaseClient,
  userId: string,
  slug: string,
): Promise<ToolEntitlement> {
  const { data: tool } = await supabase
    .from("tools")
    .select("id, name, price")
    .eq("slug", slug)
    .maybeSingle();

  // Tool not in the catalogue (e.g. not yet billed) — nothing to enforce.
  if (!tool) {
    return { status: "none", trialEndsAt: null, toolName: null, priceInr: null, locked: false };
  }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status, trial_ends_at")
    .eq("user_id", userId)
    .eq("tool_id", tool.id as string)
    .maybeSingle();

  const toolName = tool.name as string;
  const priceInr = Number(tool.price);

  if (!sub) {
    return { status: "none", trialEndsAt: null, toolName, priceInr, locked: false };
  }

  const trialEndsAt = (sub.trial_ends_at as string | null) ?? null;
  const status = effectiveStatus(sub.status as string, trialEndsAt);
  return { status, trialEndsAt, toolName, priceInr, locked: isLocked(status) };
}
