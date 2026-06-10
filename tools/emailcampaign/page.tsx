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
import { ToolLanding } from "../../core/ui/tool-landing";
import type { GallerySlide } from "../../core/ui/output-gallery";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import { ConnectMailboxCard } from "./components/smtp-setup-card";
import { ApprovalGate } from "./components/approval-gate";
import { emailCampaignApproval } from "./lib/approval";
import { UploadForm } from "./components/upload-form";
import { CampaignResultView, type Job } from "./components/result-view";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "01", title: "Connect your mailbox", body: "Pick Gmail, Office 365, Zoho, Outlook or Yahoo and paste an app password. Step-by-step guides are built in." },
  { n: "02", title: "Upload your list", body: "Drop a CSV or Excel file. We auto-detect the Email and Name columns and skip blank or invalid rows." },
  { n: "03", title: "Write & merge", body: "Compose your subject and HTML body. {{name}} personalizes every email — it works in the subject too." },
  { n: "04", title: "Send & track", body: "We send through your mailbox and show a live delivery summary with a per-recipient error log." },
];

const PILLARS = [
  { title: "Your mailbox, your reputation", body: "Bring your own SMTP — Gmail, O365, Zoho, Outlook, Yahoo. No third-party credits, no shared sending IPs." },
  { title: "No setup headaches", body: "Built-in app-password guides for each provider, including the exact request to send your IT admin for Microsoft 365." },
  { title: "Real personalization", body: "{{name}} merge in the subject and HTML body, with automatic Email & Name column detection from your file." },
];

const OUTPUT_ITEMS = [
  "A personalized HTML email per recipient ({{name}} merge)",
  "Sent through your own Gmail / O365 / Zoho / Outlook / Yahoo mailbox",
  "Auto-detected Email & Name columns (any order, typo-tolerant)",
  "Invalid / blank rows skipped, with a count",
  "Recipients accepted from your file",
  "Sent — handed off to your SMTP server",
  "Failed — rejected, with a per-recipient SMTP error log",
  "Send duration",
  "Inline app-password guides (incl. the M365 admin request)",
  "Send another campaign in one click",
];

const SLIDES: GallerySlide[] = [
  { src: "/tools/emailcampaign/out-1-setup.png", caption: "Connect your mailbox — with built-in app-password guides" },
  { src: "/tools/emailcampaign/out-2-recipients.png", caption: "Upload CSV/Excel — Email & Name auto-detected" },
  { src: "/tools/emailcampaign/out-3-compose.png", caption: "Compose with {{name}} merge" },
  { src: "/tools/emailcampaign/out-4-email.png", caption: "A personalized HTML email in every inbox" },
  { src: "/tools/emailcampaign/out-5-summary.png", caption: "Live delivery summary + error log" },
];

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
        <ToolLanding
          eyebrow="emailcampaign.kyveriqx.com · Send from your own mailbox"
          claim="Mail-merge campaigns — no per-email fees"
          stepStrip={["1. Connect mailbox", "2. Upload list", "3. Write & merge", "4. Send"]}
          headline={
            <>
              Email campaigns.
              <br />
              <span style={{ color: "var(--ink-200)" }}>From your own mailbox.</span>
            </>
          }
          subhead="Send a templated email to your CSV/Excel contact list through your own Gmail / Office 365 / Zoho / Outlook / Yahoo mailbox. Subject and body both support a {{name}} merge field."
          primaryCta={{ label: "Start free trial", href: "/auth/register" }}
          secondaryCta={{ label: "Log in", href: loginHrefWithReturn() }}
          stepsHeading="Your mailbox, your list, sent — in four steps."
          steps={STEPS}
          pillars={PILLARS}
          outputHeading="A personalized HTML email in every inbox — plus a live delivery summary."
          outputItems={OUTPUT_ITEMS}
          gallerySlides={SLIDES}
          footerLeft="© Email Campaigns — Sent from your own mailbox."
          footerRight="Powered by Vercel + Trigger.dev"
        />
      </>
    );
  }

  // Owner approval gate: a customer must be approved before they can connect a
  // mailbox or send (anti-abuse / sender reputation). Admins are auto-approved.
  const approval = await emailCampaignApproval(supabase, user.id);
  if (approval !== "approved") {
    let adminNotes: string | null = null;
    if (approval === "rejected") {
      const { data } = await supabase
        .from("emailcampaign_approvals")
        .select("admin_notes")
        .eq("user_id", user.id)
        .maybeSingle();
      adminNotes = (data?.admin_notes as string | null) ?? null;
    }
    return (
      <>
        <Nav />
        <main style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 80px" }}>
          <ApprovalGate status={approval} adminNotes={adminNotes} />
        </main>
      </>
    );
  }

  // A user can send if they've connected a mailbox via OAuth (Microsoft) OR
  // saved a custom SMTP server. Check both.
  const [{ data: smtp }, { data: oauthRow }] = await Promise.all([
    supabase
      .from("user_smtp_credentials")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_mail_oauth")
      .select("provider, account_email")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const hasSmtp = !!smtp;
  const oauth = oauthRow
    ? { provider: oauthRow.provider as string, accountEmail: oauthRow.account_email as string }
    : null;
  const hasCreds = hasSmtp || !!oauth;

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
          <ConnectMailboxCard hasSmtp={hasSmtp} oauth={oauth} />
        ) : (
          <>
            <UploadForm />
            <div style={{ marginTop: 28, textAlign: "right" }}>
              <a href="/tools/emailcampaign?settings=1" style={{ fontSize: 13, color: "var(--ink-400)", textDecoration: "none" }}>
                Update mailbox connection →
              </a>
            </div>
          </>
        )}
      </main>
    </>
  );
}
