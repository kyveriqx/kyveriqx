/* Store — store.kyveriqx.com (Architecture §1, §5).
   Catalogue + cart + checkout live under /app/store/*. */

import { Nav } from "../../core/ui/nav";
import { Card } from "../../core/ui/card";
import { Button } from "../../core/ui/button";

export default function Store() {
  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
        <h1
          style={{
            fontSize: "clamp(32px, 3.6vw, 52px)",
            lineHeight: 1.06,
            letterSpacing: "-0.022em",
            fontWeight: 600,
            margin: "0 0 24px",
          }}
        >
          Tool catalogue
        </h1>
        <p style={{ color: "var(--ink-300)", maxWidth: 720, margin: "0 0 48px" }}>
          Catalogue is data-driven — entries come from the <code>tools</code> table
          in Supabase. This page lists each tool, opens its 14-day trial on signup,
          and links to checkout once the trial ends.
        </p>
        <Card style={{ padding: 24 }}>
          <p style={{ color: "var(--ink-200)", margin: "0 0 16px" }}>
            Supabase isn't connected yet. Run Step 4 to populate the catalogue.
          </p>
          <Button variant="ghost">View setup instructions</Button>
        </Card>
      </main>
    </>
  );
}
