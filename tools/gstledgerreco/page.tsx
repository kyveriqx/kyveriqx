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
import { SignedOutGate } from "../../core/ui/signed-out-gate";
import { supabaseServer } from "../../core/lib/supabase-server";
import { getToolId } from "../../core/lib/tools";
import { UploadForm } from "./components/upload-form";
import { ReconcileResultView, type Job } from "./components/result-view";

export const dynamic = "force-dynamic";

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
        <SignedOutGate
          subdomain="gstledgerreco.kyveriqx.com"
          title="GST Ledger Reconciliation"
          description="Match your Purchase Register against GSTR-2B and flag every rupee of ITC at risk — missing in 2B, GSTIN typos, value/tax mismatches, filed-late suppliers. Add GSTR-1 and your Sales Register to reconcile the outward side too."
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
