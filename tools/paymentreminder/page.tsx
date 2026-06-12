/* Customer Payment Reminder — sibling of the Email Campaigns tool.

   Same three-state shape as the ledger reco tools:
     Signed-out                        → ToolLanding CTA
     Signed-in, not approved           → ApprovalGate (shared with emailcampaign)
     Signed-in, no mailbox connected   → ConnectMailboxCard
     Signed-in, mailbox + no jobId      → UploadForm
     Signed-in, jobId in URL           → CampaignResultView (polls /api/jobs/[id])

   Reminders go out from the customer's own mailbox (Microsoft OAuth or a custom
   SMTP relay) — the very same connection used by Email Campaigns. Trigger.dev
   runs the send loop async; the browser polls Supabase for status. */

import { Nav } from "../../core/ui/nav";
import { ToolLanding } from "../../core/ui/tool-landing";
import type { GallerySlide } from "../../core/ui/output-gallery";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import { ConnectMailboxCard } from "./components/smtp-setup-card";
import { ApprovalGate } from "./components/approval-gate";
import { paymentReminderApproval } from "./lib/approval";
import { UploadForm } from "./components/upload-form";
import { CampaignResultView, type Job } from "./components/result-view";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "01", title: "Connect your mailbox", body: "Connect Microsoft 365 / Outlook in one click, or paste an app password for Gmail/Zoho/Yahoo. Reminders go out from your own address." },
  { n: "02", title: "Upload your customer list", body: "Drop a CSV or Excel file. We auto-detect Email, Name, Invoice, Amount, Balance and Due Date columns and skip blank or invalid rows." },
  { n: "03", title: "Write & merge", body: "Compose a reminder with {{name}}, {{amount}}, {{invoice_number}}, {{balance}} and {{due_date}} — each one personalised per customer." },
  { n: "04", title: "Send & track", body: "We send through your mailbox and show a live delivery summary with a per-customer error log." },
];

const PILLARS = [
  { title: "Chase dues, personally", body: "Every reminder is merged with the customer's name, invoice number, amount due and balance — no generic blasts, no manual copy-paste." },
  { title: "Your mailbox, your reputation", body: "Send from your own Microsoft 365 / Outlook / Gmail / Zoho mailbox. No third-party credits, no shared sending IPs." },
  { title: "Invoice-aware templates", body: "Reference the exact invoice and amount in each message, with automatic column detection from your existing receivables sheet." },
];

const OUTPUT_ITEMS = [
  "A personalised reminder per customer (name, invoice, amount, balance, due date)",
  "Sent through your own Microsoft 365 / Outlook / Gmail / Zoho mailbox",
  "Auto-detected Email, Name, Invoice, Amount, Balance & Due Date columns",
  "Invalid / blank rows skipped, with a count",
  "Customers accepted from your file",
  "Sent — handed off to your mailbox",
  "Failed — rejected, with a per-customer error log",
  "Send duration",
  "Built-in app-password guides (incl. the M365 admin request)",
  "Send another reminder run in one click",
];

const SLIDES: GallerySlide[] = [
  { src: "/tools/paymentreminder/out-1-setup.png", caption: "Connect your mailbox — with built-in app-password guides" },
  { src: "/tools/paymentreminder/out-2-recipients.png", caption: "Upload CSV/Excel — Email, Invoice & Amount auto-detected" },
  { src: "/tools/paymentreminder/out-3-compose.png", caption: "Compose with invoice & amount merge fields" },
  { src: "/tools/paymentreminder/out-4-email.png", caption: "A personalised reminder in every inbox" },
  { src: "/tools/paymentreminder/out-5-summary.png", caption: "Live delivery summary + error log" },
];

type Props = { searchParams: { jobId?: string; settings?: string } };

export default async function PaymentReminder({ searchParams }: Props) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const jobId = searchParams.jobId;
  const wantsSettings = searchParams.settings === "1";

  if (!user) {
    return (
      <>
        <Nav />
        <ToolLanding
          eyebrow="paymentreminder.kyveriqx.com · Send from your own mailbox"
          claim="Customer payment reminders — no per-email fees"
          stepStrip={["1. Connect mailbox", "2. Upload list", "3. Write & merge", "4. Send"]}
          headline={
            <>
              Customer payment reminders.
              <br />
              <span style={{ color: "var(--ink-200)" }}>From your own mailbox.</span>
            </>
          }
          subhead="Send personalised payment reminders to your customers/debtors from your own Microsoft 365 / Outlook / Gmail / Zoho mailbox. Merge the customer's name, invoice number, amount and outstanding balance into every message."
          primaryCta={{ label: "Start free trial", href: "/auth/register" }}
          secondaryCta={{ label: "Log in", href: loginHrefWithReturn() }}
          stepsHeading="Your mailbox, your receivables, chased — in four steps."
          steps={STEPS}
          pillars={PILLARS}
          outputHeading="A personalised reminder in every inbox — plus a live delivery summary."
          outputItems={OUTPUT_ITEMS}
          gallerySlides={SLIDES}
          footerLeft="© Customer Payment Reminder — Sent from your own mailbox."
          footerRight="Powered by Vercel + Trigger.dev"
        />
      </>
    );
  }

  // Owner approval gate (shared with Email Campaigns): a customer must be
  // approved before they can connect a mailbox or send. Admins are auto-approved.
  const approval = await paymentReminderApproval(supabase, user.id);
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
            <a href="/tools/paymentreminder" style={{ fontSize: 14, color: "var(--blue-400)", textDecoration: "none" }}>
              ← Send another reminder run
            </a>
          </div>
        ) : !hasCreds || wantsSettings ? (
          <>
            {hasCreds && (
              <div style={{ marginBottom: 16 }}>
                <a
                  href="/tools/paymentreminder"
                  style={{ fontSize: 14, color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  ← Back to your reminders
                </a>
              </div>
            )}
            <ConnectMailboxCard hasSmtp={hasSmtp} oauth={oauth} />
          </>
        ) : (
          <>
            <MailboxStrip oauth={oauth} />
            <UploadForm defaultPreviewName={previewNameFromUser(user.email, user.user_metadata)} />
          </>
        )}
      </main>
    </>
  );
}

/** Best-guess first name for the live-preview default: prefer a name set at
 *  signup (user_metadata), otherwise derive it from the email's local part
 *  ("chandrakant@alpha.co.in" → "Chandrakant"). */
function previewNameFromUser(
  email: string | undefined,
  meta: Record<string, unknown> | undefined,
): string {
  const metaName = (meta?.full_name ?? meta?.name ?? meta?.display_name) as string | undefined;
  if (metaName && metaName.trim()) return metaName.trim().split(/\s+/)[0];
  const local = (email ?? "").split("@")[0]?.split(/[._-]/)[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "there";
}

/** Clear, always-visible strip at the top of the compose screen showing which
 *  mailbox the reminders send from, with an obvious "Change mailbox" button —
 *  so a non-technical user never has to hunt for where to connect/switch. */
function MailboxStrip({ oauth }: { oauth: { provider: string; accountEmail: string } | null }) {
  const isMs = oauth?.provider === "microsoft";
  const email = oauth?.accountEmail ?? null;
  const method = oauth ? (isMs ? "Microsoft 365 / Outlook" : oauth.provider) : "Custom SMTP server";

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      flexWrap: "wrap", marginBottom: 24, padding: "14px 18px",
      background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span style={{ fontSize: 20 }}>📤</span>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 11, color: "var(--ink-400)", fontFamily: "var(--font-mono)",
            letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            Sending from
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-100)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {email ? `${email} · ${method}` : method}
          </div>
        </div>
      </div>
      <a
        href="/tools/paymentreminder?settings=1"
        style={{
          flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 14px", fontSize: 13, fontWeight: 600,
          color: "var(--accent)", background: "var(--accent-bg-soft)",
          border: "1px solid var(--accent-border-soft)", borderRadius: 8, textDecoration: "none",
        }}
      >
        Change mailbox →
      </a>
    </div>
  );
}
