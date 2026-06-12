/* Email campaign sender — Architecture §8.5.

   Downloads the user's recipient list, looks up their saved SMTP
   credentials, decrypts the password in-process, and sends one
   templated email per row through nodemailer. Per-row results are
   collected and the summary is written back to public.jobs.result via
   runJob.

   v1 is serial — simpler, and the user's own SMTP relay sets the rate.
   If a customer hits a rate cap we can add a small concurrency knob
   later without changing the public shape of CampaignResult. */

import { logger, task } from "@trigger.dev/sdk";
import nodemailer, { type Transporter } from "nodemailer";
import { runJob } from "../../../core/lib/job-runner";
import { downloadSupabaseUpload } from "../../../core/lib/supabase-uploads";
import { STORAGE_BUCKETS } from "../../../core/lib/storage-buckets";
import { supabaseAdmin } from "../../../core/lib/supabase";
import { decryptSmtpPassword, decryptSecret } from "../../../core/lib/smtp-crypto";
import { refreshAccessToken, sendMailViaGraph } from "../../../core/lib/ms-oauth";
import { parseRecipients } from "../lib/parse";
import { applyMerge } from "../lib/merge";
import type { CampaignResult, SendError, Recipient } from "../lib/types";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  recipientsUploadId: string;
  subject: string;
  body: string;
  /** Fixed addresses CC'd/BCC'd on every email (optional). */
  cc?: string[];
  bcc?: string[];
};

const BUCKET = STORAGE_BUCKETS.emailcampaignUploads;

type SmtpCredsRow = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password_enc: string; // bytea — postgrest returns base64 hex/escape; we coerce
  password_iv: string;
  from_email: string;
  from_name: string | null;
};

type OAuthRow = {
  provider: string;
  account_email: string;
  display_name: string | null;
  from_name: string | null;
  refresh_token_enc: string;
  refresh_token_iv: string;
};

/** Sends one templated email; returns nothing on success, throws on failure.
 *  Both send paths (OAuth/Graph and SMTP/nodemailer) implement this shape so
 *  the serial loop below doesn't care which mailbox backend is in use. */
type SendOne = (r: Recipient) => Promise<void>;

function toBuffer(bytea: unknown): Buffer {
  if (Buffer.isBuffer(bytea)) return bytea;
  if (typeof bytea === "string") {
    // PostgREST returns bytea as `\x...` hex by default.
    if (bytea.startsWith("\\x")) return Buffer.from(bytea.slice(2), "hex");
    // Some clients (depending on column config) return base64.
    return Buffer.from(bytea, "base64");
  }
  if (bytea && typeof bytea === "object" && "data" in (bytea as Record<string, unknown>)) {
    return Buffer.from((bytea as { data: number[] }).data);
  }
  throw new Error("Unexpected bytea encoding from Supabase.");
}

export const sendEmailCampaign = task({
  id: "send-email-campaign",
  maxDuration: 1800, // 30 min — enough for a few thousand serial sends
  run: (payload: Payload) =>
    runJob<Payload, CampaignResult>(payload, async (p) => {
      const startedAt = Date.now();
      logger.info("starting email campaign", {
        jobId: p.jobId,
        userId: p.userId,
        recipientsUploadId: p.recipientsUploadId,
      });

      // ── 1. Download + parse the recipient list ───────────────────────────
      const buffer = await downloadSupabaseUpload(`supabase:${p.recipientsUploadId}`, BUCKET);
      if (!buffer) {
        throw new Error(`Could not download recipient list (upload ${p.recipientsUploadId}).`);
      }
      const { recipients, dropped, totalRows } = parseRecipients(buffer);
      logger.info("recipients parsed", { totalRows, valid: recipients.length, dropped });
      if (recipients.length === 0) {
        throw new Error(
          dropped > 0
            ? `No valid email addresses found — all ${dropped} row(s) were rejected.`
            : "Recipient file is empty.",
        );
      }

      // ── 2. Resolve the send path: OAuth (Microsoft/Graph) or SMTP ────────
      // An OAuth connection takes precedence over a stored SMTP server.
      const admin = supabaseAdmin();
      const { data: oauth } = await admin
        .from("user_mail_oauth")
        .select("provider, account_email, display_name, from_name, refresh_token_enc, refresh_token_iv")
        .eq("user_id", p.userId)
        .maybeSingle<OAuthRow>();

      let sendOne: SendOne;
      let closeTransport: () => void = () => {};

      if (oauth) {
        // ── OAuth path: refresh an access token, send via Graph ───────────
        const refreshToken = decryptSecret(
          toBuffer(oauth.refresh_token_enc),
          toBuffer(oauth.refresh_token_iv),
        );
        let accessToken: string;
        try {
          ({ accessToken } = await refreshAccessToken(refreshToken));
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Could not refresh your Microsoft sign-in (${m}). Please reconnect your ` +
              `mailbox under "Update mailbox connection".`,
          );
        }
        const fromName = oauth.from_name ?? oauth.display_name ?? null;
        sendOne = (r) =>
          sendMailViaGraph({
            accessToken,
            accountEmail: oauth.account_email,
            fromName,
            to: r.email,
            subject: applyMerge(p.subject, r),
            html: applyMerge(p.body, r),
            cc: p.cc,
            bcc: p.bcc,
          });
        logger.info("send path: oauth", { provider: oauth.provider, account: oauth.account_email });
      } else {
        // ── SMTP path: existing nodemailer relay ──────────────────────────
        const { data: creds, error: credsErr } = await admin
          .from("user_smtp_credentials")
          .select("host, port, secure, username, password_enc, password_iv, from_email, from_name")
          .eq("user_id", p.userId)
          .maybeSingle<SmtpCredsRow>();
        if (credsErr || !creds) {
          throw new Error(
            credsErr
              ? `Could not load SMTP credentials: ${credsErr.message}`
              : "No mailbox connected — please complete mailbox setup first.",
          );
        }
        const password = decryptSmtpPassword(
          toBuffer(creds.password_enc),
          toBuffer(creds.password_iv),
        );
        const transporter: Transporter = nodemailer.createTransport({
          host: creds.host,
          port: creds.port,
          secure: creds.secure,
          auth: { user: creds.username, pass: password },
        });
        try {
          await transporter.verify();
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          throw new Error(`SMTP connection failed: ${m}`);
        }
        const fromHeader = creds.from_name
          ? `"${creds.from_name.replace(/"/g, '\\"')}" <${creds.from_email}>`
          : creds.from_email;
        sendOne = (r) =>
          transporter.sendMail({
            from: fromHeader,
            to: r.email,
            cc: p.cc,
            bcc: p.bcc,
            subject: applyMerge(p.subject, r),
            html: applyMerge(p.body, r),
          }).then(() => undefined);
        closeTransport = () => transporter.close();
        logger.info("send path: smtp", { host: creds.host });
      }

      // ── 3. Serial send loop ─────────────────────────────────────────────
      const errors: SendError[] = [];
      let sent = 0;
      for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        try {
          await sendOne(r);
          sent++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ email: r.email, message });
        }
        if ((i + 1) % 25 === 0) {
          logger.info("send progress", { sent, failed: errors.length, of: recipients.length });
        }
      }

      closeTransport();

      const result: CampaignResult = {
        total: recipients.length,
        sent,
        failed: errors.length,
        errors,
        durationMs: Date.now() - startedAt,
      };
      logger.info("email campaign done", {
        jobId: p.jobId,
        ...result,
        droppedFromFile: dropped,
      });
      return result;
    }),
});
