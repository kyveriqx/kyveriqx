/* Razorpay billing client — Architecture §8.6.
   Chosen over Stripe because customers are Indian businesses billing in INR
   (Architecture §4). One Razorpay Plan per tool, priced from `tools.price`. */

import Razorpay from "razorpay";
import { createHmac, timingSafeEqual } from "node:crypto";

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

export function razorpayClient(): Razorpay {
  const { keyId, keySecret } = razorpayConfig();
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/* Resolve the Razorpay plan_id for a tool slug. Plans live in the dashboard;
   we map them through env vars so swapping test↔live is a one-line change
   and the IDs never land in git. */
export function planIdForSlug(slug: string): string {
  const envKey = `RAZORPAY_PLAN_${slug.toUpperCase()}`;
  const planId = process.env[envKey];
  if (!planId) {
    throw new Error(`Missing ${envKey} — create the Razorpay Plan and set this env var.`);
  }
  return planId;
}

/* Verify a Razorpay webhook signature (HMAC-SHA256 over the raw body).
   Uses timing-safe comparison so we don't leak the secret via timing. */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const { webhookSecret } = razorpayConfig();
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
