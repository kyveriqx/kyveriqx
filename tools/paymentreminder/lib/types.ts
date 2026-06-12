/* Shared types for the Customer Payment Reminder tool. */

export type Recipient = {
  /** Lower-cased, trimmed email address (the only required field). */
  email: string;
  /** Customer / debtor name — {{name}} merge field. May be empty. */
  name: string;
  /** Amount due for the referenced invoice — {{amount}} merge field. */
  amount: string;
  /** Total outstanding balance as on date — {{balance}} merge field. */
  balance: string;
  /** Invoice / bill reference number — {{invoice_number}} merge field. */
  invoiceNumber: string;
  /** Free-text invoice particulars — {{invoice_details}} merge field. */
  invoiceDetails: string;
  /** Due / payment date as written in the file — {{due_date}} merge field. */
  dueDate: string;
};

export type SendError = {
  email: string;
  message: string;
};

/** Shape written to public.jobs.result for the send-payment-reminder task.
 *  Read by tools/paymentreminder/components/result-view.tsx. */
export type CampaignResult = {
  total: number;
  sent: number;
  failed: number;
  errors: SendError[];
  durationMs: number;
};
