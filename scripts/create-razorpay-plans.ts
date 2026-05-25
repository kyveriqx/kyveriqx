/* One-shot: create one Razorpay Plan per tool at ₹1/month (test mode).
   Run with:
       npx tsx scripts/create-razorpay-plans.ts
   Reads RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET from .env.local.
   Prints the slug → plan_id mapping ready to paste into .env.local. */

import Razorpay from "razorpay";
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

const TOOLS = [
  { slug: "gstledgerreco",    name: "GST Ledger Reconciliation" },
  { slug: "bankledgerreco",   name: "Bank Ledger Reconciliation" },
  { slug: "orgledgerreco",    name: "Org Ledger Reconciliation" },
  { slug: "custportal",       name: "Customer Portal" },
  { slug: "callingtool",      name: "AI Calling Tool" },
  { slug: "whatsappcampaign", name: "WhatsApp Campaigns" },
];

async function main() {
  loadEnvLocal();
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    console.error("Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env.local");
    process.exit(1);
  }

  const rp = new Razorpay({ key_id: keyId, key_secret: keySecret });

  const results: { slug: string; planId: string }[] = [];
  for (const tool of TOOLS) {
    const plan = await rp.plans.create({
      period: "monthly",
      interval: 1,
      item: {
        name: `Kyveriqx — ${tool.name}`,
        amount: 100,            // paise; 100 paise = ₹1
        currency: "INR",
        description: `${tool.name} monthly subscription (test)`,
      },
      notes: { slug: tool.slug },
    });
    results.push({ slug: tool.slug, planId: plan.id });
    console.log(`  ✓ ${tool.slug.padEnd(18)} ${plan.id}`);
  }

  console.log("\nPaste these into .env.local:\n");
  for (const r of results) {
    console.log(`RAZORPAY_PLAN_${r.slug.toUpperCase()}=${r.planId}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
