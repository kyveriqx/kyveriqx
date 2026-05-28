/* Layout wrapper for /tools/*.

   Opts every tool's workspace into the light theme by setting
   `data-theme="light"` on a wrapper div. The CSS cascade picks this up
   via the [data-theme="light"] block in core/styles/tokens.css.

   Marketing / store / auth all sit outside /tools/* and stay on the
   default dark theme. The site-wide <Nav /> renders inside each tool
   page's own component tree (above this wrapper's main content), so it
   too stays dark — the dark Nav above a light workspace is the intended
   horizontal split.

   We also paint the page background here so the dark <body> background
   from app/globals.css doesn't bleed through. */

import type { ReactNode } from "react";
import { headers } from "next/headers";
import { supabaseServer } from "../../core/lib/supabase-server";
import { toolEntitlement } from "../../core/lib/entitlement";
import { TrialEndedGate } from "../../core/ui/trial-ended";

/** Which tool this request resolved to. Middleware sets x-tool-slug on the
 *  tool subdomain; for direct /tools/<slug> access (dev) fall back to the
 *  pre-rewrite pathname middleware also exposes as x-pathname. */
function toolSlug(): string | null {
  const h = headers();
  const direct = h.get("x-tool-slug");
  if (direct) return direct;
  const m = (h.get("x-pathname") ?? "").match(/^\/tools\/([^/]+)/);
  return m ? m[1] : null;
}

export default async function ToolsLayout({ children }: { children: ReactNode }) {
  let content: ReactNode = children;

  const slug = toolSlug();
  if (slug) {
    const supabase = supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    // Signed-out users fall through: the tool page shows its own marketing
    // SignedOutGate. We only lock signed-in users whose access has lapsed.
    if (user) {
      const ent = await toolEntitlement(supabase, user.id, slug);
      if (ent.locked && (ent.status === "expired" || ent.status === "cancelled")) {
        content = (
          <TrialEndedGate
            slug={slug}
            toolName={ent.toolName ?? "this tool"}
            priceInr={ent.priceInr ?? 0}
            status={ent.status}
            trialEndsAt={ent.trialEndsAt}
            userEmail={user.email ?? undefined}
          />
        );
      }
    }
  }

  return (
    <div
      data-theme="light"
      style={{
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        minHeight: "100vh",
      }}
    >
      {content}
    </div>
  );
}
