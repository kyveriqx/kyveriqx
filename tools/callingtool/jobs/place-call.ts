/* Trigger.dev job for placing calls — Architecture §3, §8.5.
   Telephony provider: Plivo or Exotel preferred for India per doc.
   The browser never dials directly; it submits a number and the
   Trigger.dev job runs the actual call + retries. */

export const meta = {
  toolSlug: "callingtool",
  jobId: "place-call",
  provider: "plivo" as "plivo" | "exotel" | "twilio",
};
