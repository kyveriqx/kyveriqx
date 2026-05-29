/* Supabase Storage bucket names — single source of truth.

   Every bucket the app reads or writes is referenced through this map
   instead of hardcoded string literals so that renaming a bucket means
   touching one file. Used by the per-tool API routes, the Trigger.dev
   tasks, and scripts/provision-storage.mjs. */

export const STORAGE_BUCKETS = {
  /** orgledgerreco + gstledgerreco + bankledgerreco — shared input bucket. */
  ledgerUploads: "ledger-uploads",
  /** orgmis tool inputs (GL, Sales, Purchase, Inventory, …). */
  orgmisUploads: "orgmis-uploads",
  /** orgmis generated deliverables (xlsx + pptx + pdf). */
  orgmisOutputs: "orgmis-outputs",
  /** emailcampaign recipient lists (CSV / Excel). */
  emailcampaignUploads: "emailcampaign-uploads",
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/** Tool slug → upload bucket. The generic POST /api/uploads handler uses
 *  this to pick the right private bucket per tool so the handler doesn't
 *  trust a client-supplied bucket name. New tools (tool #3 onwards) just
 *  add their slug + bucket here. */
export const UPLOAD_BUCKET_BY_TOOL_SLUG: Record<string, StorageBucket> = {
  gstledgerreco: STORAGE_BUCKETS.ledgerUploads,
  bankledgerreco: STORAGE_BUCKETS.ledgerUploads,
  orgledgerreco: STORAGE_BUCKETS.ledgerUploads,
  orgmis: STORAGE_BUCKETS.orgmisUploads,
  emailcampaign: STORAGE_BUCKETS.emailcampaignUploads,
};
