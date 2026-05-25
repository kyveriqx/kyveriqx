/* Marketing site root — kyveriqx.com / www.kyveriqx.com.
   Placeholder per Architecture §8.1 Step 1 verification: shows
   the navy/blue theme is wired up. Full copy and section
   structure are out of scope for the platform-build plan. */

import { Nav } from "../core/ui/nav";

export default function MarketingHome() {
  return (
    <>
    <Nav />
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "120px 24px" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--blue-500)",
        }}
      >
        <span
          style={{
            width: 28,
            height: 1,
            background:
              "linear-gradient(90deg, var(--blue-500), transparent)",
          }}
        />
        Kyveriqx
      </span>
      <h1
        style={{
          fontSize: "clamp(40px, 5.4vw, 76px)",
          lineHeight: 1.02,
          letterSpacing: "-0.025em",
          fontWeight: 600,
          margin: "16px 0 24px",
        }}
      >
        AI tools platform.
      </h1>
      <p
        style={{
          maxWidth: 720,
          fontSize: 18,
          lineHeight: 1.55,
          color: "var(--ink-200)",
          margin: 0,
        }}
      >
        A marketplace of reconciliation and outreach tools. Each tool lives
        on its own subdomain, with a 14-day free trial, then per-tool
        subscription billing.
      </p>
    </main>
    </>
  );
}
