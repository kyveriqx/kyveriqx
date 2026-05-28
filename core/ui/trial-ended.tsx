/* Lock screen shown in place of a tool's workspace once access has lapsed.
   Rendered by app/tools/layout.tsx when toolEntitlement().locked is true.
   Carries its own <Nav /> because it replaces the tool page's entire tree. */

import { Nav } from "./nav";
import { Card } from "./card";
import { SubscribeButton } from "./subscribe-button";

type Props = {
  slug: string;
  toolName: string;
  priceInr: number;
  status: "expired" | "cancelled";
  trialEndsAt: string | null;
  userEmail?: string;
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export function TrialEndedGate({ slug, toolName, priceInr, status, trialEndsAt, userEmail }: Props) {
  const endedOn = formatDate(trialEndsAt);
  const cancelled = status === "cancelled";

  const heading = cancelled ? "Your subscription has ended" : "Your free trial has ended";
  const body = cancelled
    ? `Reactivate ${toolName} to keep using it.`
    : endedOn
    ? `Your 15-day free trial of ${toolName} ended on ${endedOn}.`
    : `Your 15-day free trial of ${toolName} has ended.`;

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 24px" }}>
        <Card style={{ padding: 32 }}>
          <div style={{ display: "grid", gap: 16, justifyItems: "center", textAlign: "center" }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--text-primary)" }}>
              {heading}
            </h1>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 15, lineHeight: 1.5 }}>
              {body} Subscribe to continue — <strong>₹{priceInr}/month</strong>.
            </p>
            <SubscribeButton
              toolSlug={slug}
              userEmail={userEmail}
              label={cancelled ? "Reactivate" : "Subscribe to continue"}
            />
          </div>
        </Card>
      </main>
    </>
  );
}
