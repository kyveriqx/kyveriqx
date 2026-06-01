/* Management / BOD MIS Generator — Architecture §8.5.

   Marketing landing page for the tool. Same hero for signed-out (with "Start
   free trial / Log in" CTAs) and signed-in (with "Get Started / Skip to Upload"
   CTAs). Rendered via the shared ToolLanding template so every tool's landing
   shares one layout — see core/ui/tool-landing.tsx.

   Rendered inside app/tools/orgmis/layout.tsx, which wraps it in <Nav /> and
   inherits data-theme="light" from app/tools/layout. */

import { ToolLanding } from "../../core/ui/tool-landing";
import type { GallerySlide } from "../../core/ui/output-gallery";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "01", title: "Set up your branding", body: "Logo, company name, tagline, vision. Saved for next time." },
  { n: "02", title: "Upload your data", body: "GL/Trial Balance, Sales, Purchase, Inventory. Drag & drop." },
  { n: "03", title: "Preview KPIs live", body: "Revenue, EBITDA, margins, top customers — all in your browser." },
  { n: "04", title: "Generate & download", body: "Excel MIS + PPT deck + PDF, all branded with your identity." },
];

const PILLARS = [
  { title: "Fast", body: "From raw export to board-ready PDF in under 60 seconds." },
  { title: "Reliable", body: "Heavy lifting runs on Trigger.dev — retries, durability, observability." },
  { title: "Repeatable", body: "Branding saved. Every quarter, every year, one-click refresh." },
];

const REPORT_CONTENTS = [
  "Cover & Agenda",
  "Company Snapshot",
  "Financial Highlights (Revenue, EBITDA, PAT)",
  "Detailed P&L Statement",
  "Monthly Revenue Trend",
  "Top Customers & Vendors",
  "Geographic & Currency Mix",
  "Working Capital Analysis (DSO/DPO/CCC)",
  "Key Achievements",
  "Strategic Outlook FY 2025-26",
  "Risks, Asks & Discussion",
  "Margin Profile",
  "GL Category Summary",
  "Notes & Assumptions",
];

const SLIDES: GallerySlide[] = [
  { src: "/tools/orgmis/out-1-cover.png", caption: "Branded PPT cover slide" },
  { src: "/tools/orgmis/out-2-highlights.png", caption: "Financial Highlights — Revenue, EBITDA, PAT at a glance" },
  { src: "/tools/orgmis/out-3-trends.png", caption: "Revenue & margin trends" },
  { src: "/tools/orgmis/out-4-customers.png", caption: "Top customers & vendors" },
  { src: "/tools/orgmis/out-5-excel.png", caption: "10-sheet Excel MIS workbook" },
  { src: "/tools/orgmis/out-6-pdf.png", caption: "Board-ready PDF report" },
];

export default async function OrgMisLanding() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const primaryCta = user
    ? { label: "Get Started", href: "/tools/orgmis/settings" }
    : { label: "Start free trial", href: "/auth/register" };
  const secondaryCta = user
    ? { label: "Skip to Upload", href: "/tools/orgmis/upload" }
    : { label: "Log in", href: loginHrefWithReturn() };

  return (
    <ToolLanding
      eyebrow="orgmis.kyveriqx.com · Board Reports in Minutes"
      claim="Generate board decks 100× faster"
      stepStrip={["1. Branding", "2. Upload Data", "3. Preview", "4. Generate"]}
      headline={
        <>
          Board reports.
          <br />
          <span style={{ color: "var(--ink-200)" }}>In minutes, not weeks.</span>
        </>
      }
      subhead="Upload your ERP exports — GL, Sales, Purchase, Inventory. Customize your branding. Download a board-ready Excel MIS, PowerPoint deck, and PDF."
      primaryCta={primaryCta}
      secondaryCta={secondaryCta}
      stepsHeading="Four simple steps. No spreadsheet wrestling."
      steps={STEPS}
      pillars={PILLARS}
      outputHeading="Up to 15 data-driven slides + 10-sheet MIS workbook + locked PDF."
      outputItems={REPORT_CONTENTS}
      gallerySlides={SLIDES}
      footerLeft="© BOD MIS Tool — Built for finance teams."
      footerRight="Powered by Vercel + Trigger.dev"
    />
  );
}
