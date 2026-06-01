/* Bank Ledger Reconciliation — Architecture §8.5.

   Signed-out users → CTA to register/login.
   Signed-in users (no jobId) → upload form for bank + books (+ settlement).
   Signed-in users (jobId in URL) → result view.

   Same shape as the Org Ledger Reconciliation tool. The reconciliation runs
   via Trigger.dev (async), so unlike orgledgerreco the job may still be
   queued/running on first paint — we preload the row server-side and let
   ReconcileResultView poll until it's terminal. */

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
  { n: "01", title: "Upload statement & ledger", body: "Your bank statement + the same account's books ledger from your ERP. CSV, Excel or PDF — drop several files (e.g. one per month) and we merge them." },
  { n: "02", title: "Add settlement (optional)", body: "Attach Razorpay's settlement export for exact gateway-fee + GST matching, or skip it and we infer the fee from the amounts." },
  { n: "03", title: "Set your tolerance", body: "Pick a date window for posting/settlement lag and a max gateway-fee % so genuine lag and rounding don't show up as gaps." },
  { n: "04", title: "Reconcile & download", body: "See matched groups, gaps and a priority action plan live — then export every unmatched line as CSV." },
];

const PILLARS = [
  { title: "Smart matching", body: "Exact, date-tolerant, UPI day-aggregation, gateway-fee and reversal matching — not just naive 1:1." },
  { title: "Auto-flagged", body: "Bank charges, interest, TDS and reversals are detected and labelled, so you know what needs a journal entry." },
  { title: "Actionable", body: "A bank-vs-books net-gap check, a priority action plan, and a CSV of every exception for your team." },
];

const OUTPUT_ITEMS = [
  "Bank vs books balance + net gap",
  "Match summary by method (exact, date-tolerant, grouped, gateway, settlement, reversal)",
  "Matched groups with confidence (high / medium / low)",
  "UPI day-aggregation (many book rows ↔ one bank line)",
  "Gateway / Razorpay settlement fees identified",
  "Unmatched on your bank statement",
  "Unmatched in your books",
  "Auto-flagged bank charges, interest & TDS",
  "Possible reversals / refunds",
  "Priority action plan (URGENT / MEDIUM / FINAL)",
  "CSV: bank-reconciliation-exceptions.csv",
];

const SLIDES: GallerySlide[] = [
  { src: "/tools/bankledgerreco/out-1-balance.png", caption: "Bank vs books — balance, net gap & match summary" },
  { src: "/tools/bankledgerreco/out-2-matched.png", caption: "Matched groups with confidence" },
  { src: "/tools/bankledgerreco/out-3-gaps.png", caption: "Gaps — unmatched on bank & in books" },
  { src: "/tools/bankledgerreco/out-4-action-plan.png", caption: "Priority action plan" },
  { src: "/tools/bankledgerreco/out-5-csv.png", caption: "Download-ready exceptions CSV" },
];

type Props = { searchParams: { jobId?: string } };

export default async function BankLedgerReco({ searchParams }: Props) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const jobId = searchParams.jobId;

  let toolId: string | null = null;
  let initialJob: Job | null = null;
  if (user) {
    toolId = await getToolId(supabase, "bankledgerreco");
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
          eyebrow="bankledgerreco.kyveriqx.com · Bank vs books, tied out in minutes"
          claim="Reconcile a month in minutes, not days"
          stepStrip={["1. Upload statement", "2. Upload ledger", "3. Set tolerance", "4. Reconcile"]}
          headline={
            <>
              Your bank and your books.
              <br />
              <span style={{ color: "var(--ink-200)" }}>Tied out in minutes.</span>
            </>
          }
          subhead="Match your bank statement against your books. Handles UPI day-aggregation, Razorpay settlement fees, posting-date lag, bank charges and reversals — then shows you exactly what doesn't tie out."
          primaryCta={{ label: "Start free trial", href: "/auth/register" }}
          secondaryCta={{ label: "Log in", href: loginHrefWithReturn() }}
          stepsHeading="From statement to reconciled — in four steps."
          steps={STEPS}
          pillars={PILLARS}
          outputHeading="A live reconciliation dashboard plus a CSV of every exception."
          outputItems={OUTPUT_ITEMS}
          gallerySlides={SLIDES}
          footerLeft="© Bank Ledger Reconciliation — Built for finance teams."
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
            <a href="/tools/bankledgerreco" style={{ fontSize: 14, color: "var(--blue-400)", textDecoration: "none" }}>
              ← Run another reconciliation
            </a>
          </div>
        )}
      </main>
    </>
  );
}
