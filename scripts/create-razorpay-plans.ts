/* Create one Razorpay Plan per tool, priced from the `tools` table.
   Run with:
       npx tsx scripts/create-razorpay-plans.ts
   Reads RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET and the Supabase service-role
   credentials from .env.local.

   Each plan's amount comes from tools.price — so adding a new tool (e.g. an
   email-automation tool at ₹199) or changing a price needs NO edits here:
   update the DB and re-run. Prints the slug → plan_id mapping ready to paste
   into .env.local (and your host's env).

   Note: Razorpay Plans are immutable — you can't change a plan's price after
   creation. Re-running creates NEW plans with new ids; point the
   RAZORPAY_PLAN_* env vars at the new ids and the old plans simply go unused. */

import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined || process.env[m[1]] === "") {
      process.env[m[1]] = m[2];
    }
  }
}

async function main() {
  loadEnvLocal();

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!keyId || !keySecret) {
    console.error("Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env.local");
    process.exit(1);
  }
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const mode = keyId.startsWith("rzp_live_") ? "LIVE — real money" : "TEST";
  console.log(`Razorpay mode: ${mode} (${keyId.slice(0, 12)}…)\n`);

  const supa = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: tools, error } = await supa
    .from("tools")
    .select("slug, name, price")
    .eq("is_active", true)
    .order("slug");
  if (error) {
    console.error(`Failed to read tools from Supabase: ${error.message}`);
    process.exit(1);
  }
  if (!tools?.length) {
    console.error("No active tools found in the tools table.");
    process.exit(1);
  }

  const rp = new Razorpay({ key_id: keyId, key_secret: keySecret });

  const results: { slug: string; planId: string; price: number }[] = [];
  for (const tool of tools) {
    const price = Number(tool.price);
    if (!(price > 0)) {
      console.error(`  ✗ ${tool.slug.padEnd(18)} price is ₹${price} — skipped (fix tools.price first)`);
      continue;
    }
    const plan = await rp.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: `Kyveriqx — ${tool.name}`,
        amount: Math.round(price * 100),   // paise; ₹99 → 9900
        currency: "INR",
        description: `${tool.name} — monthly subscription`,
      },
      notes: { slug: tool.slug },
    });
    results.push({ slug: tool.slug, planId: plan.id, price });
    console.log(`  ✓ ${tool.slug.padEnd(18)} ₹${String(price).padEnd(4)} ${plan.id}`);
  }

  console.log("\nPaste these into .env.local AND your host's env:\n");
  for (const r of results) {
    console.log(`RAZORPAY_PLAN_${r.slug.toUpperCase()}=${r.planId}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
