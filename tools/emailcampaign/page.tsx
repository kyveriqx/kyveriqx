/* Email Campaigns — Architecture §8.5.

   Same three-state shape as the ledger reco tools:
     Signed-out                        → SignedOutGate CTA
     Signed-in, no SMTP creds          → SmtpSetupCard
     Signed-in, no jobId, creds saved  → UploadForm
     Signed-in, jobId in URL           → CampaignResultView (polls /api/jobs/[id])

   v1 ships BYO SMTP: the user signs in with their own mailbox (Gmail /
   Office 365 / Zoho / Outlook / Yahoo / custom) and we send through it.
   Trigger.dev runs the send loop async, the browser polls Supabase for
   status — no direct chatter with Trigger.dev from the client. */

import { Nav } from "../../core/ui/nav";
import { SignedOutGate } from "../../core/ui/signed-out-gate";
import { supabaseServer } from "../../core/lib/supabase-server";
import { SmtpSetupCard } from "./components/smtp-setup-card";
import { UploadForm } from "./components/upload-form";
import { CampaignResultView, type Job } from "./components/result-view";

export const dynamic = "force-dynamic";

type Props = { searchParams: { jobId?: string; settings?: string } };

export default async function EmailCampaign({ searchParams }: Props) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const jobId = searchParams.jobId;
  const wantsSettings = searchParams.settings === "1";

  if (!user) {
    return (
      <>
        <Nav />
        <SignedOutGate
          subdomain="emailcampaign.kyveriqx.com"
          title="Email Campaigns"
          description="Send a templated email to your CSV/Excel contact list through your own Gmail / Office 365 / Zoho / Outlook / Yahoo mailbox. Subject and body both support a {{name}} merge field."
        />
      </>
    );
  }

  const { data: creds } = await supabase
    .from("user_smtp_credentials")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const hasCreds = !!creds;

  let initialJob: Job | null = null;
  if (jobId) {
    const { data } = await supabase
      .from("jobs")
      .select("id, status, result, error, updated_at, job_key")
      .eq("id", jobId)
      .maybeSingle();
    initialJob = (data as Job | null) ?? null;
  }

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 80px" }}>
        {jobId ? (
          <div style={{ display: "grid", gap: 16 }}>
            <CampaignResultView jobId={jobId} initialJob={initialJob ?? undefined} />
            <a href="/tools/emailcampaign" style={{ fontSize: 14, color: "var(--blue-400)", textDecoration: "none" }}>
              ← Send another campaign
            </a>
          </div>
        ) : !hasCreds || wantsSettings ? (
          <SmtpSetupCard hasExisting={hasCreds} />
        ) : (
          <>
            <UploadForm />
            <div style={{ marginTop: 28, textAlign: "right" }}>
              <a href="/tools/emailcampaign?settings=1" style={{ fontSize: 13, color: "var(--ink-400)", textDecoration: "none" }}>
                Update SMTP settings →
              </a>
            </div>
          </>
        )}
      </main>
    </>
  );
}
