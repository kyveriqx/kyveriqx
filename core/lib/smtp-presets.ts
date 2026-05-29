/* SMTP provider presets — single source of truth for the well-known
   mailbox hosts the emailcampaign tool offers in its provider dropdown.

   Why a preset map: most users send through Gmail / Office 365 / Zoho /
   Outlook.com / Yahoo. Those hosts have stable, public SMTP settings —
   asking the user to type smtp.gmail.com / 465 / SSL every time is hostile
   UX. The dropdown picks a provider; only `"other"` reveals the manual
   host / port / secure fields.

   The same map is read by:
     - the SmtpSetupCard dropdown (label + appPasswordHelpUrl)
     - saveSmtpCredentialsAction (resolveSmtpConfig)
   so renaming a label or fixing a host is a one-file change. */

export type SmtpProvider =
  | "gmail"
  | "office365"
  | "zoho"
  | "outlook"
  | "yahoo"
  | "other";

export type SmtpProviderPreset = {
  label: string;
  host: string;
  port: number;
  /** true = implicit TLS on port 465; false = STARTTLS on 587. */
  secure: boolean;
  /** Where to send users who haven't enabled an app-specific password yet. */
  appPasswordHelpUrl: string;
  /** Short imperative steps shown in the inline "How to get your app
   *  password" panel on the SMTP setup card. 3–4 steps, ≤ ~90 chars each. */
  appPasswordSteps: string[];
};

export const SMTP_PRESETS: Record<Exclude<SmtpProvider, "other">, SmtpProviderPreset> = {
  gmail: {
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    appPasswordHelpUrl: "https://support.google.com/accounts/answer/185833",
    appPasswordSteps: [
      "Turn on 2-Step Verification on your Google account (required for app passwords).",
      "Open https://myaccount.google.com/apppasswords in a new tab.",
      "Create a new app password — give it a name like “Kyveriqx”.",
      "Copy the 16-character password Google shows you and paste it in the Password field below.",
    ],
  },
  office365: {
    label: "Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    appPasswordHelpUrl:
      "https://support.microsoft.com/en-us/account-billing/5896ed9b-4263-e681-128a-a6f2979a7944",
    appPasswordSteps: [
      "Ask your admin to enable SMTP AUTH for your mailbox if it’s disabled (M365 turns it off by default).",
      "Turn on 2-Step Verification on your Microsoft account.",
      "Open account.microsoft.com → Security → Advanced security options → App passwords.",
      "Create a new app password and paste it in the Password field below.",
    ],
  },
  zoho: {
    label: "Zoho Mail",
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    appPasswordHelpUrl:
      "https://www.zoho.com/mail/help/adminconsole/two-factor-authentication.html",
    appPasswordSteps: [
      "Sign in to Zoho Mail → My Account → Security → App Passwords.",
      "Click Generate New Password and name it “Kyveriqx”.",
      "Copy the password Zoho shows you and paste it in the Password field below.",
      "Your normal Zoho password won’t work over SMTP once 2FA is on.",
    ],
  },
  outlook: {
    label: "Outlook.com",
    host: "smtp-mail.outlook.com",
    port: 587,
    secure: false,
    appPasswordHelpUrl:
      "https://support.microsoft.com/en-us/account-billing/5896ed9b-4263-e681-128a-a6f2979a7944",
    appPasswordSteps: [
      "Turn on 2-Step Verification on your Microsoft account.",
      "Open account.microsoft.com → Security → Advanced security options.",
      "Under App passwords, click Create a new app password.",
      "Copy the generated password and paste it in the Password field below.",
    ],
  },
  yahoo: {
    label: "Yahoo Mail",
    host: "smtp.mail.yahoo.com",
    port: 465,
    secure: true,
    appPasswordHelpUrl: "https://help.yahoo.com/kb/SLN15241.html",
    appPasswordSteps: [
      "Sign in at login.yahoo.com → Account Info → Account Security.",
      "Turn on 2-Step Verification if it isn’t already.",
      "Under “Generate app password”, enter “Kyveriqx” and click Generate.",
      "Copy the 16-character password Yahoo shows you and paste it in the Password field below.",
    ],
  },
};

export const SMTP_PROVIDER_ORDER: SmtpProvider[] = [
  "gmail",
  "office365",
  "zoho",
  "outlook",
  "yahoo",
  "other",
];

export type ResolvedSmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
};

export type ManualSmtpFields = {
  host?: string;
  port?: number;
  secure?: boolean;
};

/** Resolve a provider key + (optional) manual fields into the final
 *  {host, port, secure} that nodemailer needs.
 *
 *  - For a known preset, manual fields are ignored — the preset wins.
 *  - For `"other"`, all three manual fields are required and we throw a
 *    clear error if any are missing.
 *
 *  Throws a user-friendly Error on bad input so the server action can
 *  surface the message to the form without leaking internals. */
export function resolveSmtpConfig(
  provider: SmtpProvider,
  manual?: ManualSmtpFields,
): ResolvedSmtpConfig {
  if (provider !== "other") {
    const preset = SMTP_PRESETS[provider];
    if (!preset) {
      throw new Error(`Unknown SMTP provider: ${provider}`);
    }
    return { host: preset.host, port: preset.port, secure: preset.secure };
  }

  const host = (manual?.host ?? "").trim();
  const port = manual?.port;
  const secure = manual?.secure;

  if (!host) throw new Error("SMTP host is required for a custom provider.");
  if (!Number.isFinite(port) || (port as number) <= 0 || (port as number) > 65535) {
    throw new Error("SMTP port must be a number between 1 and 65535.");
  }
  if (typeof secure !== "boolean") {
    throw new Error("SMTP TLS mode (secure) is required for a custom provider.");
  }
  return { host, port: port as number, secure };
}

/** Type guard: the string came from the dropdown and is a known provider key. */
export function isKnownSmtpProvider(s: string): s is SmtpProvider {
  return (SMTP_PROVIDER_ORDER as string[]).includes(s);
}
