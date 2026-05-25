/* Razorpay billing client — Architecture §8.6.
   Chosen over Stripe because customers are Indian businesses billing in INR
   (Architecture §4). Wiring is stubbed until the Razorpay account exists. */

export type RazorpayConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
};

export function razorpayConfig(): RazorpayConfig {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !keySecret || !webhookSecret) {
    throw new Error(
      "Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET",
    );
  }
  return { keyId, keySecret, webhookSecret };
}

/* Real client is wired in once Step 6 begins:
 *   import Razorpay from "razorpay";
 *   const rp = new Razorpay({ key_id, key_secret });
 *   const sub = await rp.subscriptions.create({ plan_id, total_count, ... });
 * Plans are one-per-tool, priced in INR per `tools.price`. */
