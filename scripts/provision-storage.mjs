/* One-off provisioning script — creates Supabase Storage buckets used by
   each tool. Idempotent: running again on existing buckets is a no-op.

   Run once per environment:  node scripts/provision-storage.mjs

   Buckets:
     ledger-uploads          — orgledgerreco (50 MB cap)
     orgmis-uploads          — Management/BOD MIS Generator inputs (20 MB cap)
     orgmis-outputs          — BOD MIS generated reports (50 MB cap)
     emailcampaign-uploads   — email campaign recipient lists (50 MB cap) */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Tiny .env.local parser (handles `KEY=value` and `KEY="value"`, ignores comments)
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const eq = l.indexOf("=");
      if (eq === -1) return null;
      const key = l.slice(0, eq).trim();
      let value = l.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [key, value];
    })
    .filter(Boolean),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supa = createClient(url, serviceKey, { auth: { persistSession: false } });

// Bucket IDs mirror core/lib/storage-buckets.ts. Keep these two lists in
// sync — this script runs as plain Node before the TS build exists, so we
// can't import the constants module directly.
const BUCKETS = [
  { id: "ledger-uploads", fileSizeLimit: 50 * 1024 * 1024 },
  { id: "orgmis-uploads", fileSizeLimit: 20 * 1024 * 1024 },
  { id: "orgmis-outputs", fileSizeLimit: 50 * 1024 * 1024 },
  { id: "emailcampaign-uploads", fileSizeLimit: 50 * 1024 * 1024 },
  { id: "paymentreminder-uploads", fileSizeLimit: 50 * 1024 * 1024 },
];

for (const { id, fileSizeLimit } of BUCKETS) {
  const { error: createErr } = await supa.storage.createBucket(id, {
    public: false,
    fileSizeLimit,
  });
  if (createErr) {
    if (/already exists|duplicate/i.test(createErr.message)) {
      console.log(`OK — bucket "${id}" already exists.`);
    } else {
      console.error(`Failed to create bucket "${id}":`, createErr.message);
      process.exit(1);
    }
  } else {
    console.log(`Created bucket "${id}" (private, ${fileSizeLimit / 1024 / 1024} MB file limit).`);
  }
}

const { data: buckets, error: listErr } = await supa.storage.listBuckets();
if (listErr) {
  console.error("Listing buckets failed:", listErr.message);
  process.exit(1);
}

console.log("All buckets in project:", buckets?.map((b) => b.name).join(", "));
