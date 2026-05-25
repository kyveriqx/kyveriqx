/* GST ledger reconciliation — Architecture §8.5.
   Matches the user's GST 2A/2B against their books.
   Real matcher lands in a follow-up commit; today this just runs
   end-to-end through Trigger.dev → Supabase. */

import { logger, task } from "@trigger.dev/sdk";
import { runJob } from "../../../core/lib/job-runner";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  uploadIds: string[];
};

export const gstReconcile = task({
  id: "gst-ledger-reconcile",
  maxDuration: 1800,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      logger.info("starting GST reconciliation", { jobId: p.jobId, uploads: p.uploadIds.length });
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 1500));
      return {
        matched_rows: 0,
        unmatched_rows: 0,
        duration_ms: Date.now() - start,
        note: "stub implementation — real GST 2A/2B matcher next",
      };
    }),
});
