/* Payment-reminder sender — sibling of tools/emailcampaign/jobs/send-campaign.ts.

   Downloads the user's customer list, resolves their mailbox (OAuth via
   Microsoft Graph, or a saved SMTP relay — decrypted in-process), and sends
   one templated reminder per row. Each row's merge fields ({{name}},
   {{amount}}, {{invoice_number}}, {{invoice_details}}, {{due_date}})
   are filled by applyMerge. Per-row results are collected and
   the summary is written back to public.jobs.result via runJob.

   Serial by design — the user's own mailbox sets the rate. */

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
import { groupByEmail, consolidatedExtras } from "../lib/consolidate";
import type { CampaignResult, SendError, Recipient, SendMode } from "../lib/types";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  recipientsUploadId: string;
  subject: string;
  body: string;
  mode?: SendMode;
};

/** One thing to send: the row whose customer-level fields drive the merge, plus
 *  any consolidated-mode extra tokens ({{total}}, {{invoice_table}}, {{count}}).
 *  In per-invoice mode `extra` is undefined and `row` is the single invoice. */
type SendUnit = { row: Recipient; extra?: Record<string, string> };

const BUCKET = STORAGE_BUCKETS.paymentReminderUploads;

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

/** Sends one templated reminder; returns nothing on success, throws on failure.
 *  Both send paths (OAuth/Graph and SMTP/nodemailer) implement this shape so
 *  the serial loop below doesn't care which mailbox backend is in use. */
type SendOne = (u: SendUnit) => Promise<void>;

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

export const sendPaymentReminder = task({
  id: "send-payment-reminder",
  maxDuration: 1800, // 30 min — enough for a few thousand serial sends
  run: (payload: Payload) =>
    runJob<Payload, CampaignResult>(payload, async (p) => {
      const startedAt = Date.now();
      logger.info("starting payment reminder", {
        jobId: p.jobId,
        userId: p.userId,
        recipientsUploadId: p.recipientsUploadId,
      });

      // ── 1. Download + parse the customer list ────────────────────────────
      const buffer = await downloadSupabaseUpload(`supabase:${p.recipientsUploadId}`, BUCKET);
      if (!buffer) {
        throw new Error(`Could not download customer list (upload ${p.recipientsUploadId}).`);
      }
      const { recipients, dropped, totalRows } = parseRecipients(buffer);
      logger.info("recipients parsed", { totalRows, valid: recipients.length, dropped });
      if (recipients.length === 0) {
        throw new Error(
          dropped > 0
            ? `No valid email addresses found — all ${dropped} row(s) were rejected.`
            : "Customer file is empty.",
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
        sendOne = (u) =>
          sendMailViaGraph({
            accessToken,
            accountEmail: oauth.account_email,
            fromName,
            to: u.row.email,
            subject: applyMerge(p.subject, u.row, u.extra),
            html: applyMerge(p.body, u.row, u.extra),
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
        sendOne = (u) =>
          transporter.sendMail({
            from: fromHeader,
            to: u.row.email,
            subject: applyMerge(p.subject, u.row, u.extra),
            html: applyMerge(p.body, u.row, u.extra),
          }).then(() => undefined);
        closeTransport = () => transporter.close();
        logger.info("send path: smtp", { host: creds.host });
      }

      // ── 3. Build send units ─────────────────────────────────────────────
      // per_invoice: one unit per row. consolidated: one unit per customer
      // (rows grouped by email), with an invoice table + summed total.
      const mode: SendMode = p.mode === "consolidated" ? "consolidated" : "per_invoice";
      let units: SendUnit[];
      if (mode === "consolidated") {
        const groups = groupByEmail(recipients);
        units = groups.map((g) => ({ row: g[0], extra: consolidatedExtras(g) }));
        logger.info("consolidated send", { customers: units.length, rows: recipients.length });
      } else {
        units = recipients.map((r) => ({ row: r }));
      }

      // ── 4. Serial send loop ─────────────────────────────────────────────
      const errors: SendError[] = [];
      let sent = 0;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        try {
          await sendOne(u);
          sent++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ email: u.row.email, message });
        }
        if ((i + 1) % 25 === 0) {
          logger.info("send progress", { sent, failed: errors.length, of: units.length });
        }
      }

      closeTransport();

      const result: CampaignResult = {
        total: units.length,
        sent,
        failed: errors.length,
        errors,
        durationMs: Date.now() - startedAt,
      };
      logger.info("payment reminder done", {
        jobId: p.jobId,
        ...result,
        droppedFromFile: dropped,
      });
      return result;
    }),
});
