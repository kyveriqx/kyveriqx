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

/** One step in the inline "How to get your app password" guide. When
 *  `url` is present the renderer appends a small "Open →" link next to
 *  the text, so the customer can jump straight to the right page
 *  instead of hunting through the provider's settings. */
export type AppPasswordStep = {
  text: string;
  url?: string;
};

export type SmtpProviderPreset = {
  label: string;
  host: string;
  port: number;
  /** true = implicit TLS on port 465; false = STARTTLS on 587. */
  secure: boolean;
  /** Catch-all link to the provider's official help docs — shown at
   *  the bottom of the inline guide as a fallback. */
  appPasswordHelpUrl: string;
  /** Short imperative steps shown in the inline "How to get your app
   *  password" panel on the SMTP setup card. 3–5 steps, ≤ ~140 chars
   *  each. Steps that point at a specific page should set `url` so the
   *  renderer can wire up a direct "Open →" link. */
  appPasswordSteps: AppPasswordStep[];
};

export const SMTP_PRESETS: Record<Exclude<SmtpProvider, "other">, SmtpProviderPreset> = {
  gmail: {
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    appPasswordHelpUrl: "https://support.google.com/accounts/answer/185833",
    appPasswordSteps: [
      {
        text: "Turn on 2-Step Verification on your Google account (required before Google will show app passwords).",
        url: "https://myaccount.google.com/signinoptions/two-step-verification",
      },
      {
        text: "Open the Google App Passwords page.",
        url: "https://myaccount.google.com/apppasswords",
      },
      {
        text: "Create a new app password — give it a name like “Kyveriqx”.",
      },
      {
        text: "Copy the 16-character password Google shows you and paste it in the Password field below.",
      },
    ],
  },
  office365: {
    label: "Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    appPasswordHelpUrl:
      "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission",
    appPasswordSteps: [
      {
        text: "Heads-up: Microsoft 365 work accounts disable SMTP basic auth by default. Many tenants block it entirely — see the official docs for what your tenant actually allows.",
        url: "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission",
      },
      {
        text: "Ask your IT admin to enable Authenticated SMTP on your mailbox. PowerShell: Set-CASMailbox -Identity you@yourdomain.com -SmtpClientAuthenticationDisabled $false (or Exchange admin center → Mailboxes → your mailbox → Manage email apps → Authenticated SMTP = On).",
        url: "https://learn.microsoft.com/en-us/powershell/module/exchange/set-casmailbox",
      },
      {
        text: "If your tenant allows app passwords (Security Defaults off + per-user MFA on), open Microsoft Security info, click Add method → App password, name it “Kyveriqx”, and copy the 16-character password.",
        url: "https://mysignins.microsoft.com/security-info",
      },
      {
        text: "Paste the password (your mailbox password if no MFA, or the app password from step 3) in the Password field below.",
      },
      {
        text: "Still hitting 535 auth errors? Your admin has locked basic auth — switch to Gmail or Zoho instead (they work without IT involvement).",
      },
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
      {
        text: "Open your Zoho Account → Security → App Passwords.",
        url: "https://accounts.zoho.com/home#security/app_passwords",
      },
      {
        text: "Click Generate New Password and name it “Kyveriqx”.",
      },
      {
        text: "Copy the password Zoho shows you and paste it in the Password field below.",
      },
      {
        text: "Your normal Zoho password won’t work over SMTP once 2FA is on — you must use an app password.",
      },
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
      {
        text: "Open your Microsoft account Security page.",
        url: "https://account.microsoft.com/security",
      },
      {
        text: "Turn on 2-Step Verification if it isn’t already.",
      },
      {
        text: "Under Advanced security options → App passwords, click Create a new app password.",
      },
      {
        text: "Copy the generated password and paste it in the Password field below.",
      },
    ],
  },
  yahoo: {
    label: "Yahoo Mail",
    host: "smtp.mail.yahoo.com",
    port: 465,
    secure: true,
    appPasswordHelpUrl: "https://help.yahoo.com/kb/SLN15241.html",
    appPasswordSteps: [
      {
        text: "Open Yahoo Account Security.",
        url: "https://login.yahoo.com/account/security",
      },
      {
        text: "Turn on 2-Step Verification if it isn’t already.",
      },
      {
        text: "Click “Generate app password”, enter “Kyveriqx”, and click Generate.",
      },
      {
        text: "Copy the 16-character password Yahoo shows you and paste it in the Password field below.",
      },
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
