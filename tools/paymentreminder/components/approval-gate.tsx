"use client";

/* Shown on the Customer Payment Reminder tool before a customer is approved to
   send. Sending is gated by owner approval (anti-abuse / sender reputation),
   shared with Email Campaigns:
     none     → "Request access" button
     pending  → waiting message
     rejected → declined message, with the option to request again
   Once the owner approves (in /admin/approvals), the page renders the normal
   Connect-mailbox / Upload flow instead of this gate. */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../core/ui/card";
import { Button } from "../../../core/ui/button";
import { requestPaymentReminderAccessAction } from "../request-access-action";

type Props = { status: "none" | "pending" | "rejected"; adminNotes?: string | null };

export function ApprovalGate({ status, adminNotes }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function request() {
    setError(null);
    startTransition(async () => {
      const res = await requestPaymentReminderAccessAction();
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <Card style={{ padding: 28, maxWidth: 620 }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-400)",
        letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        Payment reminders — access
      </div>

      {status === "pending" ? (
        <>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 8px", color: "var(--ink-100)" }}>
            Your request is awaiting approval
          </h2>
          <p style={{ color: "var(--ink-300)", fontSize: 14, margin: 0, lineHeight: 1.6 }}>
            Thanks — we&rsquo;ve received your request to send payment reminders. To
            protect deliverability we approve senders by hand; you&rsquo;ll be able
            to connect your mailbox and send as soon as it&rsquo;s approved. This is
            usually quick.
          </p>
        </>
      ) : status === "rejected" ? (
        <>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 8px", color: "var(--ink-100)" }}>
            Your request wasn&rsquo;t approved
          </h2>
          <p style={{ color: "var(--ink-300)", fontSize: 14, margin: "0 0 8px", lineHeight: 1.6 }}>
            Sender access wasn&rsquo;t granted for this account.
            {adminNotes ? "" : " If you think this is a mistake, reach out to support or request again."}
          </p>
          {adminNotes && (
            <p style={{
              color: "var(--ink-200)", fontSize: 13.5, margin: "0 0 16px",
              padding: "10px 14px", background: "var(--bg-elev)",
              border: "1px solid var(--line)", borderRadius: 10, lineHeight: 1.55,
            }}>
              {adminNotes}
            </p>
          )}
          <div style={{ marginTop: 16 }}>
            <Button onClick={request} disabled={pending}>
              {pending ? "Sending…" : "Request again"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 8px", color: "var(--ink-100)" }}>
            Request access to send payment reminders
          </h2>
          <p style={{ color: "var(--ink-300)", fontSize: 14, margin: "0 0 18px", lineHeight: 1.6 }}>
            To keep delivery healthy for everyone, sending is approved per account.
            Request access and we&rsquo;ll enable it — then you can connect your
            mailbox and send your first reminder. If you&rsquo;re already approved
            for Email Campaigns, you&rsquo;re approved here too.
          </p>
          <Button onClick={request} disabled={pending}>
            {pending ? "Sending…" : "Request access"}
          </Button>
        </>
      )}

      {error && (
        <div style={{
          marginTop: 16, color: "var(--error-fg)", padding: "10px 14px",
          background: "var(--error-bg)", border: "1px solid var(--error-border)",
          borderRadius: 10, fontSize: 13,
        }}>
          {error}
        </div>
      )}
    </Card>
  );
}
