/* GST Ledger Reconciliation — first tool to actually run a job.
   Auth-gated: signed-out users see a CTA to register/login,
   signed-in users see a Run button + the live status of their job. */

import { Nav } from "../../core/ui/nav";
import { Card } from "../../core/ui/card";
import { Button } from "../../core/ui/button";
import { JobStatus } from "../../core/ui/job-status";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import { runGstReconcileAction } from "./run-action";

export const dynamic = "force-dynamic";

type Props = { searchParams: { jobId?: string } };

export default async function GstLedgerReco({ searchParams }: Props) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const jobId = searchParams.jobId;

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "80px 24px" }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.06em",
            color: "var(--ink-400)",
          }}
        >
          gstledgerreco.kyveriqx.com
        </span>
        <h1
          style={{
            fontSize: "clamp(32px, 3.6vw, 52px)",
            lineHeight: 1.06,
            letterSpacing: "-0.022em",
            fontWeight: 600,
            margin: "8px 0 24px",
          }}
        >
          GST Ledger Reconciliation
        </h1>
        <p
          style={{
            color: "var(--ink-200)",
            maxWidth: 720,
            margin: "0 0 48px",
            fontSize: 18,
          }}
        >
          Upload your GST 2A/2B and your books; matches line by line and surfaces the differences.
        </p>

        {!user && (
          <Card style={{ padding: 24, maxWidth: 720 }}>
            <p style={{ color: "var(--ink-300)", margin: "0 0 16px" }}>
              Sign in to start your 14-day free trial.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <a href="/auth/register">
                <Button>Start free trial</Button>
              </a>
              <a href={loginHrefWithReturn()}>
                <Button variant="ghost">Log in</Button>
              </a>
            </div>
          </Card>
        )}

        {user && !jobId && (
          <Card style={{ padding: 24, maxWidth: 720 }}>
            <p style={{ color: "var(--ink-300)", margin: "0 0 16px", fontSize: 14 }}>
              Real file upload + the GST 2A/2B matcher land in the next commit.
              For now, kick the pipeline end-to-end so you can see it run.
            </p>
            <form action={runGstReconcileAction}>
              <Button type="submit">Run reconciliation</Button>
            </form>
          </Card>
        )}

        {user && jobId && (
          <div style={{ maxWidth: 720, display: "grid", gap: 16 }}>
            <JobStatus jobId={jobId} />
            <a
              href="/"
              style={{
                fontSize: 14,
                color: "var(--blue-400)",
                textDecoration: "none",
              }}
            >
              ← Run another
            </a>
          </div>
        )}
      </main>
    </>
  );
}
