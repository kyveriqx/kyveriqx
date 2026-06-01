/* GST Ledger Reconciliation — Architecture §8.5.

   Signed-out users → CTA to register/login.
   Signed-in users (no jobId) → upload form for 2B + Purchase Register
     (required) plus optional GSTR-1 / Sales Register / GSTR-2A.
   Signed-in users (jobId in URL) → result view (3 tabs).

   Same shape as the Bank Ledger Reconciliation tool: reconciliation runs
   async via Trigger.dev, so the job may still be queued/running on first
   paint — we preload the row server-side and let ReconcileResultView
   poll until it's terminal. */

import { Nav } from "../../core/ui/nav";
import { Card } from "../../core/ui/card";
import { ToolLanding } from "../../core/ui/tool-landing";
import type { GallerySlide } from "../../core/ui/output-gallery";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import { getToolId } from "../../core/lib/tools";
import { UploadForm } from "./components/upload-form";
import { ReconcileResultView, type Job } from "./components/result-view";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "01", title: "Upload the ITC pair", body: "GSTR-2B (JSON/Excel from the portal) + your Purchase Register. That's all it takes to start." },
  { n: "02", title: "Add the outward side (optional)", body: "Drop in GSTR-1 + Sales Register to reconcile sales, and GSTR-2A to catch filed-late suppliers." },
  { n: "03", title: "Set your tolerance", body: "Pick the date window and amount tolerance so genuine rounding doesn't show up as a mismatch." },
  { n: "04", title: "Reconcile & download", body: "See ITC at risk live, work the action plan, and export three ready-to-share CSVs." },
];

const PILLARS = [
  { title: "Fast", body: "Upload, click Reconcile, see every rupee of ITC at risk in seconds — no formulas, no VLOOKUP." },
  { title: "Accurate", body: "GSTINs and invoice numbers are normalized, with date & amount tolerances so only real mismatches surface." },
  { title: "Actionable", body: "A priority action plan tells you exactly who to chase, plus three CSV exports for your team." },
];

const OUTPUT_ITEMS = [
  "ITC matched & tax tied out",
  "Total tax at risk + taxable value at risk",
  "Missing in 2B (supplier hasn't filed)",
  "Missing in your books (unrecorded purchase)",
  "GSTIN mismatches (supplier typos)",
  "Value & tax differences beyond tolerance",
  "Invoice-date mismatches",
  "Supplier filing status & filed-late (with 2A)",
  "Sales vs GSTR-1 reconciliation",
  "Priority action plan (who to chase first)",
  "CSV: gst-itc-exceptions.csv",
  "CSV: gst-sales-exceptions.csv",
  "CSV: gst-supplier-rollup.csv",
];

const SLIDES: GallerySlide[] = [
  { src: "/tools/gstledgerreco/out-1-itc-risk.png", caption: "ITC at risk — matched, tax at risk & exception breakdown" },
  { src: "/tools/gstledgerreco/out-2-exceptions.png", caption: "Every exception, tagged by kind" },
  { src: "/tools/gstledgerreco/out-3-suppliers.png", caption: "Supplier filing status — books vs 2B" },
  { src: "/tools/gstledgerreco/out-4-action-plan.png", caption: "Priority action plan" },
  { src: "/tools/gstledgerreco/out-5-csv.png", caption: "Download-ready CSV exports" },
];

type Props = { searchParams: { jobId?: string } };

export default async function GstLedgerReco({ searchParams }: Props) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const jobId = searchParams.jobId;

  let toolId: string | null = null;
  let initialJob: Job | null = null;
  if (user) {
    toolId = await getToolId(supabase, "gstledgerreco");
    if (jobId) {
      const { data } = await supabase
        .from("jobs")
        .select("id, status, result, error, updated_at, job_key")
        .eq("id", jobId)
        .maybeSingle();
      initialJob = (data as Job | null) ?? null;
    }
  }

  if (!user) {
    return (
      <>
        <Nav />
        <ToolLanding
          eyebrow="gstledgerreco.kyveriqx.com · ITC at risk, found in seconds"
          claim="Catch ITC leakage before you file"
          stepStrip={["1. Upload 2B", "2. Purchase Register", "3. Set tolerance", "4. Reconcile"]}
          headline={
            <>
              Every rupee of ITC at risk.
              <br />
              <span style={{ color: "var(--ink-200)" }}>Found before you file.</span>
            </>
          }
          subhead="Match your Purchase Register against GSTR-2B and flag every rupee of ITC at risk — missing in 2B, GSTIN typos, value/tax mismatches, filed-late suppliers. Add GSTR-1 and your Sales Register to reconcile the outward side too."
          primaryCta={{ label: "Start free trial", href: "/auth/register" }}
          secondaryCta={{ label: "Log in", href: loginHrefWithReturn() }}
          stepsHeading="From raw exports to ITC at risk — in four steps."
          steps={STEPS}
          pillars={PILLARS}
          outputHeading="A live ITC-at-risk dashboard plus three download-ready CSVs."
          outputItems={OUTPUT_ITEMS}
          gallerySlides={SLIDES}
          footerLeft="© GST Ledger Reconciliation — Built for finance teams."
          footerRight="Powered by Vercel + Trigger.dev"
        />
      </>
    );
  }

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 80px" }}>
        {!jobId && toolId && <UploadForm userId={user.id} toolId={toolId} />}

        {!jobId && !toolId && (
          <Card style={{ padding: 24, maxWidth: 720 }}>
            <p style={{ color: "#FFB3B3" }}>Tool record missing — please contact support.</p>
          </Card>
        )}

        {jobId && (
          <div style={{ display: "grid", gap: 16 }}>
            <ReconcileResultView jobId={jobId} initialJob={initialJob ?? undefined} />
            <a href="/tools/gstledgerreco" style={{ fontSize: 14, color: "var(--blue-400)", textDecoration: "none" }}>
              ← Run another reconciliation
            </a>
          </div>
        )}
      </main>
    </>
  );
}
