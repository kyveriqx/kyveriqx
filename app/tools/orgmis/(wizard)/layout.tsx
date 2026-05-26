/* Wizard-only layout — wraps the 4 step pages with a max-width container
   and the StepNav. The landing page (/tools/orgmis) is OUTSIDE this group
   so it doesn't get the step pills. */

import type { ReactNode } from "react";
import StepNav from "@orgmis/components/step-nav";

export default function WizardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <StepNav />
      {children}
    </div>
  );
}
