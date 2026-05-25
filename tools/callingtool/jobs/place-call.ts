/* Calling tool — Architecture §3, §8.5.
   Browser never dials; this Trigger.dev job places the call via
   the chosen telephony provider (Plivo/Exotel preferred for India). */

import { logger, task } from "@trigger.dev/sdk";
import { runJob } from "../../../core/lib/job-runner";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  toNumber: string;
  provider?: "plivo" | "exotel" | "twilio";
};

export const placeCall = task({
  id: "place-call",
  maxDuration: 600,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      const provider = p.provider ?? "plivo";
      logger.info("placing call", { jobId: p.jobId, to: p.toNumber, provider });
      const start = Date.now();
      // Real telephony API call goes here once credentials are configured.
      await new Promise((r) => setTimeout(r, 1500));
      return {
        provider,
        to: p.toNumber,
        call_id: null as string | null,
        duration_ms: Date.now() - start,
        note: "stub implementation — telephony provider integration next",
      };
    }),
});
