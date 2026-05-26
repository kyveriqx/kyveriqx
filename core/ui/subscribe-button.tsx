"use client";

/* Subscribe button — opens Razorpay Checkout for a single tool slug.
   Flow: POST /api/billing/subscribe → Razorpay returns a subscription_id →
   open Razorpay Checkout with it → the webhook flips status to 'active'
   in Supabase, and the next page navigation will reflect it. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./button";

type RazorpayOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description?: string;
  prefill?: { email?: string; contact?: string };
  theme?: { color?: string };
  handler?: (response: { razorpay_payment_id: string }) => void;
  modal?: { ondismiss?: () => void };
};

type RazorpayInstance = { open: () => void };

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

type Props = {
  toolSlug: string;
  label?: string;
  userEmail?: string;
  size?: "md" | "sm";
};

export function SubscribeButton({ toolSlug, label = "Subscribe", userEmail, size }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolSlug }),
      });
      if (!res.ok) {
        const { error: msg } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(msg ?? `subscribe failed (${res.status})`);
      }
      const { subscriptionId, keyId, toolName, priceInr } = (await res.json()) as {
        subscriptionId: string;
        keyId: string;
        toolName: string;
        priceInr: number;
      };

      if (typeof window === "undefined" || !window.Razorpay) {
        throw new Error("Razorpay Checkout script not loaded");
      }

      const rp = new window.Razorpay({
        key: keyId,
        subscription_id: subscriptionId,
        name: "Kyveriqx",
        description: `${toolName} — ₹${priceInr}/month`,
        prefill: userEmail ? { email: userEmail } : undefined,
        theme: { color: "#1E8FE0" },
        handler: () => {
          // Webhook will mark status='active'; refresh to pull the new row.
          router.refresh();
        },
        modal: {
          ondismiss: () => setBusy(false),
        },
      });
      rp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Button onClick={onClick} disabled={busy} type="button" size={size}>
        {busy ? "Opening Razorpay…" : label}
      </Button>
      {error && (
        <span style={{ color: "#ff8080", fontSize: 13 }}>{error}</span>
      )}
    </div>
  );
}
