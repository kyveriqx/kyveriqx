/* Trigger.dev job for GST ledger reconciliation — Architecture §8.5.
   Real implementation registers via @trigger.dev/sdk once Step 5 is wired:
     - Read uploaded files from Supabase storage by `jobs.payload.upload_ids`.
     - Match line items.
     - Write result back to Supabase (`jobs.status = succeeded`, output rows). */

export const meta = {
  toolSlug: "gstledgerreco",
  jobId: "gst-ledger-reconcile",
};
