"use server";

/* Save (upsert) the current user's SMTP credentials.

   The setup card sends a `provider` key. For the known providers
   (Gmail, Office 365, Zoho, Outlook.com, Yahoo) we resolve host/port/
   secure from SMTP_PRESETS — the user never sees those fields. For
   `"other"` we accept manual host/port/secure inputs. The password is
   encrypted at the application layer before it touches Postgres. */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../core/lib/supabase-server";
import { loginHrefWithReturn } from "../../core/lib/subdomain";
import {
  isKnownSmtpProvider,
  resolveSmtpConfig,
  type SmtpProvider,
} from "../../core/lib/smtp-presets";
import { encryptSmtpPassword } from "../../core/lib/smtp-crypto";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Returns `{ error }` on any failure instead of throwing: Next.js replaces
   thrown server-action error messages with an opaque digest in production, so
   the setup card reads the return value to surface a real message. */
export async function saveSmtpCredentialsAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const providerRaw = str(formData, "provider").toLowerCase();
  if (!isKnownSmtpProvider(providerRaw)) {
    return { error: "Please choose a mail provider." };
  }
  const provider = providerRaw as SmtpProvider;

  const username = str(formData, "username");
  const password = String(formData.get("password") ?? "");
  const fromEmail = str(formData, "fromEmail").toLowerCase();
  const fromName = str(formData, "fromName");

  if (!username) return { error: "Username (mailbox login) is required." };
  if (!password) return { error: "Password is required." };
  if (!fromEmail || !EMAIL_RE.test(fromEmail)) {
    return { error: "From email is required and must be a valid address." };
  }

  // For "other", read manual host/port/secure from the form. For known
  // providers, the form omits these and resolveSmtpConfig ignores them.
  let manual: { host: string; port: number; secure: boolean } | undefined;
  if (provider === "other") {
    const portNum = Number(str(formData, "port"));
    manual = {
      host: str(formData, "host"),
      port: Number.isFinite(portNum) ? portNum : NaN,
      secure: str(formData, "secure") === "true",
    };
  }

  let host: string;
  let port: number;
  let secure: boolean;
  try {
    ({ host, port, secure } = resolveSmtpConfig(provider, manual));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid SMTP settings." };
  }

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginHrefWithReturn());

  let ciphertext: Buffer;
  let iv: Buffer;
  try {
    ({ ciphertext, iv } = encryptSmtpPassword(password));
  } catch (err) {
    // Most likely SMTP_ENCRYPTION_KEY missing/invalid in this environment.
    return { error: err instanceof Error ? err.message : "Could not secure the password." };
  }

  const { error } = await supabase
    .from("user_smtp_credentials")
    .upsert(
      {
        user_id: user.id,
        provider,
        host,
        port,
        secure,
        username,
        // Postgres bytea accepts \x-prefixed hex over the wire.
        password_enc: `\\x${ciphertext.toString("hex")}`,
        password_iv: `\\x${iv.toString("hex")}`,
        from_email: fromEmail,
        from_name: fromName || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) return { error: `Could not save SMTP credentials: ${error.message}` };

  revalidatePath("/tools/emailcampaign");
  return {};
}
