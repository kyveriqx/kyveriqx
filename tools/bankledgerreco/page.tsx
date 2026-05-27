/* Bank Ledger Reconciliation.
   Auth-gated: signed-out users see a CTA to register/login; signed-in users
   upload their bank statement + books (+ optional Razorpay settlement
   report), run the matcher, and see the live status + categorized report. */

import { Nav } from "../../core/ui/nav";
import { Card } from "../../core/ui/card";
import { Button } from "../../core/ui/button";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import { UploadRun } from "./upload-run";

export const dynamic = "force-dynamic";

type Props = { searchParams: { jobId?: string } };

export default async function BankLedgerReco({ searchParams }: Props) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.06em", color: "var(--ink-400)" }}>
          bankledgerreco.kyveriqx.com
        </span>
        <h1 style={{ fontSize: "clamp(32px, 3.6vw, 52px)", lineHeight: 1.06, letterSpacing: "-0.022em", fontWeight: 600, margin: "8px 0 24px" }}>
          Bank Ledger Reconciliation
        </h1>
        <p style={{ color: "var(--ink-200)", maxWidth: 720, margin: "0 0 48px", fontSize: 18 }}>
          Match your bank statement against your books. Handles UPI day-aggregation,
          Razorpay settlement fees, posting-date lag, bank charges and reversals — then
          shows you exactly what doesn&apos;t tie out.
        </p>

        {!user && (
          <Card style={{ padding: 24, maxWidth: 720 }}>
            <p style={{ color: "var(--ink-300)", margin: "0 0 16px" }}>
              Sign in to start your 14-day free trial.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <a href="/auth/register"><Button>Start free trial</Button></a>
              <a href={loginHrefWithReturn()}><Button variant="ghost">Log in</Button></a>
            </div>
          </Card>
        )}

        {user && <UploadRun initialJobId={searchParams.jobId} />}
      </main>
    </>
  );
}
