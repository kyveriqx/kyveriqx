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

/** One step in the DIY app-password flow. When `url` is present the
 *  renderer appends a small "Open →" link so the customer can jump
 *  straight to the right page. Keep step text crisp — ~10 words max,
 *  no jargon, no caveats. */
export type AppPasswordStep = {
  text: string;
  url?: string;
};

/** Two-path help block shown when a preset provider is selected:
 *    - askAdmin: a short copy-paste-able message for the customer's IT
 *      admin. Only present when admin involvement is realistic (e.g.
 *      M365, Zoho Workplace). Personal accounts (Gmail/Yahoo/Outlook.com)
 *      omit this.
 *    - diy: crisp self-serve steps for technical users. Always present.
 *  The renderer also adds a fixed closing line ("Paste it below. Done.")
 *  so each provider doesn't have to repeat it. */
export type AppPasswordGuide = {
  askAdmin?: {
    message: string;
  };
  diy: AppPasswordStep[];
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
  /** Inline help shown when this provider is picked from the dropdown. */
  appPasswordGuide: AppPasswordGuide;
};

export const SMTP_PRESETS: Record<Exclude<SmtpProvider, "other">, SmtpProviderPreset> = {
  gmail: {
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    appPasswordHelpUrl: "https://support.google.com/accounts/answer/185833",
    appPasswordGuide: {
      diy: [
        { text: "Turn on 2-Step Verification.", url: "https://myaccount.google.com/signinoptions/two-step-verification" },
        { text: "Open the App Passwords page.", url: "https://myaccount.google.com/apppasswords" },
        { text: "Click “Create”, name it “Kyveriqx”." },
        { text: "Copy the 16-character password Google shows you." },
      ],
    },
  },
  office365: {
    label: "Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    appPasswordHelpUrl:
      "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission",
    appPasswordGuide: {
      askAdmin: {
        message:
`Hi,

For our marketing email tool to send from my mailbox, please do these on my Microsoft 365 mailbox:

1. Turn ON "Authenticated SMTP" for me.
   - Exchange admin center → Mailboxes → my mailbox → Manage email apps → toggle Authenticated SMTP ON.
   - Or in PowerShell:
       Set-CASMailbox -Identity <my-email> -SmtpClientAuthenticationDisabled $false

2. Either:
   (a) confirm I can use my regular Microsoft 365 password for SMTP, OR
   (b) help me generate an "app password" for this tool (https://mysignins.microsoft.com/security-info → Add method → App password).

Thanks!`,
      },
      diy: [
        { text: "Open Microsoft Security info.", url: "https://mysignins.microsoft.com/security-info" },
        { text: "Click “Add method” → “App password”." },
        { text: "Name it “Kyveriqx”, click Next." },
        { text: "Copy the password Microsoft shows you." },
      ],
    },
  },
  zoho: {
    label: "Zoho Mail",
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    appPasswordHelpUrl:
      "https://www.zoho.com/mail/help/adminconsole/two-factor-authentication.html",
    appPasswordGuide: {
      askAdmin: {
        message:
`Hi,

For our marketing email tool to send from my Zoho mailbox, please:

1. Make sure IMAP/SMTP access is enabled for my account (Zoho Mail admin → Mail Account Settings → IMAP/SMTP access).
2. Confirm I'm allowed to generate an app-specific password for my account.

Thanks!`,
      },
      diy: [
        { text: "Open your Zoho App Passwords page.", url: "https://accounts.zoho.com/home#security/app_passwords" },
        { text: "Click “Generate New Password”, name it “Kyveriqx”." },
        { text: "Copy the password Zoho shows you." },
      ],
    },
  },
  outlook: {
    label: "Outlook.com",
    host: "smtp-mail.outlook.com",
    port: 587,
    secure: false,
    appPasswordHelpUrl:
      "https://support.microsoft.com/en-us/account-billing/5896ed9b-4263-e681-128a-a6f2979a7944",
    appPasswordGuide: {
      diy: [
        { text: "Open Microsoft account Security.", url: "https://account.microsoft.com/security" },
        { text: "Turn on Two-Step Verification." },
        { text: "Under Advanced security options → App passwords, click “Create”." },
        { text: "Copy the password Microsoft shows you." },
      ],
    },
  },
  yahoo: {
    label: "Yahoo Mail",
    host: "smtp.mail.yahoo.com",
    port: 465,
    secure: true,
    appPasswordHelpUrl: "https://help.yahoo.com/kb/SLN15241.html",
    appPasswordGuide: {
      diy: [
        { text: "Open Yahoo Account Security.", url: "https://login.yahoo.com/account/security" },
        { text: "Turn on Two-Step Verification." },
        { text: "Click “Generate app password”, name it “Kyveriqx”." },
        { text: "Copy the password Yahoo shows you." },
      ],
    },
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
