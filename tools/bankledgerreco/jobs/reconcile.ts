/* Bank ledger reconciliation — Architecture §8.5.
   Matches a bank statement against the user's books. */

import { logger, task } from "@trigger.dev/sdk";
import { runJob } from "../../../core/lib/job-runner";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  uploadIds: string[];
};

export const bankReconcile = task({
  id: "bank-ledger-reconcile",
  maxDuration: 1800,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      logger.info("starting bank reconciliation", { jobId: p.jobId, uploads: p.uploadIds.length });
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 1500));
      return {
        matched_rows: 0,
        unmatched_rows: 0,
        duration_ms: Date.now() - start,
        note: "stub implementation — real bank matcher next",
      };
    }),
});
