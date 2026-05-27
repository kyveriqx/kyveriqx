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
import { SignedOutGate } from "../../core/ui/signed-out-gate";
import { supabaseServer } from "../../core/lib/supabase-server";
import { getToolId } from "../../core/lib/tools";
import { UploadForm } from "./components/upload-form";
import { ReconcileResultView, type Job } from "./components/result-view";

export const dynamic = "force-dynamic";

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
        <SignedOutGate
          subdomain="bankledgerreco.kyveriqx.com"
          title="Bank Ledger Reconciliation"
          description="Match your bank statement against your books. Handles UPI day-aggregation, Razorpay settlement fees, posting-date lag, bank charges and reversals — then shows you exactly what doesn't tie out."
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
