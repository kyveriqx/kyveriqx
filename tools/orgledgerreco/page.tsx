/* Org Ledger Reconciliation — Architecture §8.5.

   Signed-out users → CTA to register/login.
   Signed-in users (no jobId) → upload form for two files.
   Signed-in users (jobId in URL) → result view, server-rendered.

   This tool now runs inline (no Trigger.dev queue), so by the time the
   page renders the job is already terminal. We fetch the job row
   server-side and seed ReconcileResultView with it so the client
   doesn't have to round-trip /api/jobs/[id] at all. */

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
  { n: "01", title: "Upload your ledger", body: "The partner's account from your ERP — Business Central, Tally, SAP, Zoho. Excel or CSV." },
  { n: "02", title: "Upload their ledger", body: "Your business partner's statement of account. Multi-location workbooks — one sheet per location — are handled automatically." },
  { n: "03", title: "Reconcile invoice-by-invoice", body: "Doc numbers are normalized (case & format-insensitive) and matched line by line, TDS-aware." },
  { n: "04", title: "Review & download", body: "See balances, gaps and a priority action plan live — then download a 4-sheet Excel report to send back." },
];

const PILLARS = [
  { title: "Invoice-by-invoice", body: "Normalized doc-number matching ties out every invoice, not just the closing balances." },
  { title: "Multi-location & TDS-aware", body: "Handles partner workbooks with one location per sheet and flags TDS-deduction differences." },
  { title: "Actionable", body: "Per-location status, a priority action plan that says who owns each fix, and an Excel report to share." },
];

const OUTPUT_ITEMS = [
  "Your books vs partner's books — closing balances",
  "Total gap (zero = fully reconciled)",
  "Matched invoices",
  "TDS-difference invoices flagged",
  "Amount-mismatch invoices",
  "Payments in your books, not in theirs",
  "Invoices in your books, not in theirs",
  "Invoices in their books, not in yours",
  "Per-location status (settled / outstanding)",
  "Priority action plan (URGENT / MEDIUM / FINAL, by owner)",
  "Excel report: Summary · Matched · Gaps · Action Plan",
];

const SLIDES: GallerySlide[] = [
  { src: "/tools/orgledgerreco/out-1-balance.png", caption: "Your books vs partner's — balances & total gap" },
  { src: "/tools/orgledgerreco/out-2-matched.png", caption: "Matched invoices (TDS & amount diffs flagged)" },
  { src: "/tools/orgledgerreco/out-3-gaps.png", caption: "Gaps — unmatched on either side" },
  { src: "/tools/orgledgerreco/out-4-action-plan.png", caption: "Priority action plan, by owner" },
  { src: "/tools/orgledgerreco/out-5-excel.png", caption: "4-sheet Excel report to share" },
];

type Props = { searchParams: { jobId?: string } };

export default async function OrgLedgerReco({ searchParams }: Props) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const jobId = searchParams.jobId;

  // For the upload form we need the tool's UUID (RLS requires it on the
  // uploads row). Fetch it server-side so the browser client doesn't have
  // to round-trip.
  let toolId: string | null = null;
  let initialJob: Job | null = null;
  if (user) {
    toolId = await getToolId(supabase, "orgledgerreco");

    // Preload the job row when we have a jobId so the result view renders
    // immediately, no client poll on first paint.
    if (jobId) {
      const { data } = await supabase
        .from("jobs")
        .select("id, status, result, error, updated_at, job_key")
        .eq("id", jobId)
        .maybeSingle();
      initialJob = (data as Job | null) ?? null;
    }
  }

  // Signed-out path keeps the marketing-style header; signed-in workspace
  // path lets the UploadForm own its own header banner so they don't double up.
  if (!user) {
    return (
      <>
        <Nav />
        <ToolLanding
          eyebrow="orgledgerreco.kyveriqx.com · You vs your partner, tied out"
          claim="Settle partner accounts in minutes"
          stepStrip={["1. Your ledger", "2. Partner ledger", "3. Reconcile", "4. Download"]}
          headline={
            <>
              Your books and your partner&apos;s.
              <br />
              <span style={{ color: "var(--ink-200)" }}>Matched, invoice by invoice.</span>
            </>
          }
          subhead="Reconcile your books against a business partner's (multi-location, TDS-aware) ledger. Upload both files; we match invoice-by-invoice and surface the gaps in minutes."
          primaryCta={{ label: "Start free trial", href: "/auth/register" }}
          secondaryCta={{ label: "Log in", href: loginHrefWithReturn() }}
          stepsHeading="From two ledgers to a clean reconciliation — in four steps."
          steps={STEPS}
          pillars={PILLARS}
          outputHeading="A live reconciliation dashboard plus a 4-sheet Excel report to share."
          outputItems={OUTPUT_ITEMS}
          gallerySlides={SLIDES}
          footerLeft="© Org Ledger Reconciliation — Built for finance teams."
          footerRight="Powered by Vercel"
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
            <p style={{ color: "#FFB3B3" }}>
              Tool record missing — please contact support.
            </p>
          </Card>
        )}

        {jobId && (
          <div style={{ display: "grid", gap: 16 }}>
            <ReconcileResultView jobId={jobId} initialJob={initialJob ?? undefined} />
            <a href="/tools/orgledgerreco" style={{
              fontSize: 14, color: "var(--blue-400)", textDecoration: "none",
            }}>
              ← Run another reconciliation
            </a>
          </div>
        )}
      </main>
    </>
  );
}
