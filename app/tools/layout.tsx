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

export default function ToolsLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-theme="light"
      style={{
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        minHeight: "100vh",
      }}
    >
      {children}
    </div>
  );
}
