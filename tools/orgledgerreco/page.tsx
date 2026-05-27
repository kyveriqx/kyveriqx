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
import { Button } from "../../core/ui/button";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import { UploadForm } from "./components/upload-form";
import { ReconcileResultView, type Job } from "./components/result-view";

export const dynamic = "force-dynamic";

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
    const { data: tool } = await supabase
      .from("tools")
      .select("id")
      .eq("slug", "orgledgerreco")
      .maybeSingle();
    toolId = tool?.id ?? null;

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
        <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 12,
            letterSpacing: "0.06em", color: "var(--ink-400)",
          }}>
            orgledgerreco.kyveriqx.com
          </span>
          <h1 style={{
            fontSize: "clamp(32px, 3.6vw, 52px)",
            lineHeight: 1.06, letterSpacing: "-0.022em",
            fontWeight: 600, margin: "8px 0 24px",
          }}>
            Org Ledger Reconciliation
          </h1>
          <p style={{
            color: "var(--ink-200)", maxWidth: 720,
            margin: "0 0 48px", fontSize: 18,
          }}>
            Reconcile your books against a business partner's (multi-location, TDS-aware) ledger.
            Upload both files; we match invoice-by-invoice and surface the gaps in minutes.
          </p>
          <Card style={{ padding: 24, maxWidth: 720 }}>
            <p style={{ color: "var(--ink-300)", margin: "0 0 16px" }}>
              Sign in to start your 14-day free trial.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <a href="/auth/register"><Button>Start free trial</Button></a>
              <a href={loginHrefWithReturn()}><Button variant="ghost">Log in</Button></a>
            </div>
          </Card>
        </main>
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
