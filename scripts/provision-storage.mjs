/* One-off provisioning script — creates the Supabase Storage bucket used by
   the Org Ledger Reconciliation tool.

   Run once per environment:  node scripts/provision-storage.mjs

   Uses the service-role key from .env.local. Idempotent: re-running on an
   existing bucket reports OK and exits 0. Because uploads now go through
   the server-side /api/uploads route (using the service role, bypassing
   RLS), we only need the bucket to exist — no RLS policies required on
   storage.objects. */

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

const BUCKET = "ledger-uploads";

const { error: createErr } = await supa.storage.createBucket(BUCKET, {
  public: false,
  fileSizeLimit: 50 * 1024 * 1024, // 50 MB — match the upload-form cap
});

if (createErr) {
  if (/already exists|duplicate/i.test(createErr.message)) {
    console.log(`OK — bucket "${BUCKET}" already exists.`);
  } else {
    console.error("Failed to create bucket:", createErr.message);
    process.exit(1);
  }
} else {
  console.log(`Created bucket "${BUCKET}" (private, 50 MB file limit).`);
}

const { data: buckets, error: listErr } = await supa.storage.listBuckets();
if (listErr) {
  console.error("Listing buckets failed:", listErr.message);
  process.exit(1);
}

console.log("All buckets in project:", buckets?.map((b) => b.name).join(", "));
