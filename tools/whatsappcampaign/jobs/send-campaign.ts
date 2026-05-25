/* WhatsApp campaign sender — Architecture §8.5.
   Iterates the campaign's recipient list and sends via the chosen
   WhatsApp Business API provider; writes per-message status back. */

import { logger, task } from "@trigger.dev/sdk";
import { runJob } from "../../../core/lib/job-runner";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  templateId: string;
  recipientCount: number;
};

export const sendCampaign = task({
  id: "send-whatsapp-campaign",
  maxDuration: 1800,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      logger.info("starting whatsapp campaign", { jobId: p.jobId, recipients: p.recipientCount });
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 1500));
      return {
        sent: 0,
        failed: 0,
        recipient_count: p.recipientCount,
        template_id: p.templateId,
        duration_ms: Date.now() - start,
        note: "stub implementation — WhatsApp BSP integration next",
      };
    }),
});
