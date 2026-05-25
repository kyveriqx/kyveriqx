/* Trigger.dev job for WhatsApp campaign sends — Architecture §8.5.
   Iterates the campaign's recipient list, sends via the chosen WhatsApp
   Business API provider, writes per-message status back to Supabase. */

export const meta = {
  toolSlug: "whatsappcampaign",
  jobId: "send-whatsapp-campaign",
};
