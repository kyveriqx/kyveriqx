/* POST /api/webhooks/razorpay — Architecture §8.6.
   Razorpay calls this URL on every subscription lifecycle event. We verify
   the HMAC signature against the raw body, then mirror the new state into
   `public.subscriptions` keyed by razorpay_subscription_id.

   Uses the service-role key because the webhook is not a user session — it
   updates rows on behalf of a user RLS would otherwise block. */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "../../../../core/lib/razorpay";

export const dynamic = "force-dynamic";

type Status = "trial" | "active" | "expired" | "cancelled";

type SubscriptionEntity = {
  id: string;
  current_end?: number | null;          // unix seconds
  charge_at?: number | null;            // unix seconds
};

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function periodEndIso(sub: SubscriptionEntity): string | null {
  const unix = sub.current_end ?? sub.charge_at;
  return unix ? new Date(unix * 1000).toISOString() : null;
}

async function applyUpdate(
  razorpaySubscriptionId: string,
  status: Status,
  currentPeriodEnd: string | null,
) {
  const supa = supabaseAdmin();
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (currentPeriodEnd) patch.current_period_end = currentPeriodEnd;

  const { error } = await supa
    .from("subscriptions")
    .update(patch)
    .eq("razorpay_subscription_id", razorpaySubscriptionId);
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);
}

export async function POST(req: Request) {
  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as {
    event: string;
    payload?: { subscription?: { entity?: SubscriptionEntity } };
  };

  const sub = event.payload?.subscription?.entity;
  if (!sub?.id) {
    // payment.* events without a subscription entity — ack and move on.
    return NextResponse.json({ received: true });
  }

  switch (event.event) {
    case "subscription.activated":
    case "subscription.authenticated":
    case "subscription.resumed":
    case "subscription.charged":
      await applyUpdate(sub.id, "active", periodEndIso(sub));
      break;

    case "subscription.cancelled":
    case "subscription.paused":
      await applyUpdate(sub.id, "cancelled", periodEndIso(sub));
      break;

    case "subscription.completed":
    case "subscription.expired":
      await applyUpdate(sub.id, "expired", periodEndIso(sub));
      break;

    default:
      // Unhandled event — ack so Razorpay stops retrying.
      break;
  }

  return NextResponse.json({ received: true });
}
