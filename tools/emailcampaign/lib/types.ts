/* Shared types for the emailcampaign tool. */

export type Recipient = {
  /** Lower-cased, trimmed email address (the only required field). */
  email: string;
  /** Display name used by the {{name}} merge field. May be empty. */
  name: string;
};

export type SendError = {
  email: string;
  message: string;
};

/** Shape written to public.jobs.result for the send-email-campaign task.
 *  Read by tools/emailcampaign/components/result-view.tsx. */
export type CampaignResult = {
  total: number;
  sent: number;
  failed: number;
  errors: SendError[];
  durationMs: number;
};
