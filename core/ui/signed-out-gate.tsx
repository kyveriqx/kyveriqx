/* Signed-out auth gate — Architecture §8.5.

   The "Sign in to start your 15-day free trial" card that every tool's
   signed-out landing renders. Same hero copy varies (subdomain, title,
   description) but the gate itself is identical, so centralising stops
   it being copy-pasted into each new tool's page. */

import { Card } from "./card";
import { Button } from "./button";
import { loginHrefWithReturn } from "../lib/subdomain";

type Props = {
  /** e.g. "orgledgerreco.kyveriqx.com" — small mono-font breadcrumb. */
  subdomain: string;
  /** Hero title rendered above the description. */
  title: string;
  /** Short paragraph below the title. */
  description: string;
};

export function SignedOutGate({ subdomain, title, description }: Props) {
  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 12,
        letterSpacing: "0.06em", color: "var(--ink-400)",
      }}>
        {subdomain}
      </span>
      <h1 style={{
        fontSize: "clamp(32px, 3.6vw, 52px)",
        lineHeight: 1.06, letterSpacing: "-0.022em",
        fontWeight: 600, margin: "8px 0 24px",
      }}>
        {title}
      </h1>
      <p style={{
        color: "var(--ink-200)", maxWidth: 720,
        margin: "0 0 48px", fontSize: 18,
      }}>
        {description}
      </p>
      <Card style={{ padding: 24, maxWidth: 720 }}>
        <p style={{ color: "var(--ink-300)", margin: "0 0 16px" }}>
          Sign in to start your 15-day free trial — no card or payment details needed.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/auth/register"><Button>Start free trial</Button></a>
          <a href={loginHrefWithReturn()}><Button variant="ghost">Log in</Button></a>
        </div>
      </Card>
    </main>
  );
}
