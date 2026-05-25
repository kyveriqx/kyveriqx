/* Shared placeholder rendered by each /tools/<sub>/page.tsx until
   the tool's real UI is built. Validates that the subdomain router
   landed at the right route and the theme is applied. */

import { Nav } from "./nav";
import { Card } from "./card";
import { Button } from "./button";

type Props = {
  name: string;
  slug: string;
  description: string;
};

export function ToolPlaceholder({ name, slug, description }: Props) {
  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.06em",
            color: "var(--ink-400)",
          }}
        >
          {slug}.kyveriqx.com
        </span>
        <h1
          style={{
            fontSize: "clamp(32px, 3.6vw, 52px)",
            lineHeight: 1.06,
            letterSpacing: "-0.022em",
            fontWeight: 600,
            margin: "8px 0 24px",
          }}
        >
          {name}
        </h1>
        <p style={{ color: "var(--ink-200)", maxWidth: 720, margin: "0 0 48px", fontSize: 18 }}>
          {description}
        </p>
        <Card style={{ padding: 24, maxWidth: 720 }}>
          <p style={{ color: "var(--ink-300)", margin: "0 0 16px" }}>
            This tool's UI and Trigger.dev job are stubbed. The subdomain router
            (Architecture §5) loaded this page from <code>/tools/{slug}/page.tsx</code>.
          </p>
          <Button variant="ghost">Start 14-day trial</Button>
        </Card>
      </main>
    </>
  );
}
