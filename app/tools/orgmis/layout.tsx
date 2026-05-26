/* Layout for all /tools/orgmis/* routes.

   Renders the global Kyveriqx Nav (so the user can always escape to
   /store or sign out) plus a max-width main container with Tailwind
   utilities active. The step-nav is rendered inside each wizard page
   (settings/upload/preview/generate) — the landing page omits it.

   This layout is nested inside app/tools/layout.tsx (data-theme="light"),
   so the workspace already has the light-themed background. */

import type { ReactNode } from "react";
import { Nav } from "../../../core/ui/nav";

export const dynamic = "force-dynamic";

export default function OrgMisLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
