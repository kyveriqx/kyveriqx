/* POST /api/billing/subscribe — Architecture §8.6.
   Creates a Razorpay subscription for the signed-in user × the requested tool,
   stores the razorpay_subscription_id on the user's existing subscriptions row
   (created at signup as a 15-day trial), and returns what the browser needs
   to open Razorpay Checkout. The status flips to 'active' from the webhook. */

import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../core/lib/supabase-server";
import {
  razorpayClient,
  razorpayConfig,
  planIdForSlug,
} from "../../../../core/lib/razorpay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { toolSlug?: string };
  const toolSlug = body.toolSlug?.trim();
  if (!toolSlug) {
    return NextResponse.json({ error: "toolSlug is required" }, { status: 400 });
  }

  const { data: tool, error: toolErr } = await supabase
    .from("tools")
    .select("id, slug, name, price")
    .eq("slug", toolSlug)
    .maybeSingle();
  if (toolErr) return NextResponse.json({ error: toolErr.message }, { status: 500 });
  if (!tool) return NextResponse.json({ error: "unknown tool" }, { status: 404 });

  const planId = planIdForSlug(tool.slug);

  // 12 monthly charges = one year commitment; Razorpay re-prompts on renewal.
  const rp = razorpayClient();
  const sub = await rp.subscriptions.create({
    plan_id: planId,
    total_count: 12,
    customer_notify: 1,
    notes: { user_id: user.id, tool_id: tool.id, tool_slug: tool.slug },
  });

  const { error: updateErr } = await supabase
    .from("subscriptions")
    .update({
      razorpay_subscription_id: sub.id,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("tool_id", tool.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    subscriptionId: sub.id,
    keyId: razorpayConfig().keyId,
    toolName: tool.name,
    priceInr: Number(tool.price),
  });
}
