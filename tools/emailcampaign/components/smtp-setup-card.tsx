"use client";

/* "Connect your mailbox" — shown when the user has no sending method yet, or
   when they re-open the tool (?settings=1) to change it.

   Two ways to connect:
     1. Connect Microsoft (recommended) — OAuth popup; the user signs in on
        Microsoft's own site and we send via the Graph API. No password, no app
        password, no admin SMTP setup. This is the path that actually works for
        Microsoft 365 / Outlook.
     2. Advanced — a custom SMTP server (Gmail app password, Zoho, Yahoo, or
        your own domain). Collapsed by default.

   Office 365 is intentionally absent from the SMTP dropdown — the OAuth button
   supersedes it (M365 disables SMTP AUTH by default). */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../../core/ui/button";
import { Card } from "../../../core/ui/card";
import {
  SMTP_PRESETS,
  SMTP_PROVIDER_ORDER,
  type SmtpProvider,
} from "../../../core/lib/smtp-presets";
import { saveSmtpCredentialsAction } from "../save-smtp-action";
import { disconnectMailboxAction } from "../disconnect-mailbox-action";

export type OAuthConnection = { provider: string; accountEmail: string };

type Props = {
  /** True when a custom SMTP credentials row already exists. */
  hasSmtp: boolean;
  /** Present when the user has connected a mailbox via OAuth (e.g. Microsoft). */
  oauth: OAuthConnection | null;
};

// SMTP dropdown order minus office365 — OAuth replaces the M365 password path.
const SMTP_PROVIDER_CHOICES = SMTP_PROVIDER_ORDER.filter((k) => k !== "office365");

export function ConnectMailboxCard({ hasSmtp, oauth }: Props) {
  const router = useRouter();
  const isConnected = !!oauth || hasSmtp;

  return (
    <Card style={{ padding: 28, maxWidth: 720 }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-400)",
        letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        Step 0 — Connect your mailbox
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 6px", color: "var(--ink-100)" }}>
        {isConnected ? "Your sending mailbox" : "Connect your mailbox"}
      </h2>
      <p style={{ color: "var(--ink-300)", fontSize: 14, margin: "0 0 22px", lineHeight: 1.55 }}>
        Campaigns are sent <em>from</em> your own mailbox. The quickest way is to
        connect Microsoft — you sign in on Microsoft&rsquo;s site and approve once.
        We never see or store your password.
      </p>

      <MicrosoftSection oauth={oauth} onChanged={() => router.refresh()} />

      <AdvancedSmtp hasSmtp={hasSmtp} onSaved={() => router.refresh()} />
    </Card>
  );
}

/* ── Microsoft (OAuth) ─────────────────────────────────────────────────── */

function MicrosoftSection({
  oauth,
  onChanged,
}: {
  oauth: OAuthConnection | null;
  onChanged: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, startDisconnect] = useTransition();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  function connect() {
    setError(null);
    setConnecting(true);

    const w = 520;
    const h = 640;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open(
      "/api/oauth/microsoft/start",
      "ms-oauth",
      `width=${w},height=${h},left=${left},top=${top}`,
    );

    // Popup blocked → fall back to a full-page redirect to the same start URL.
    if (!popup) {
      window.location.href = "/api/oauth/microsoft/start";
      return;
    }

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; ok?: boolean; error?: string } | null;
      if (!data || data.type !== "ms-oauth") return;
      cleanup();
      setConnecting(false);
      if (data.ok) onChanged();
      else setError(data.error || "Connection failed. Please try again.");
    };

    // Detect the user closing the popup without finishing.
    const poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        setConnecting(false);
      }
    }, 600);

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    window.addEventListener("message", onMessage);
  }

  function disconnect() {
    setError(null);
    startDisconnect(async () => {
      const res = await disconnectMailboxAction();
      if (res?.error) setError(res.error);
      else onChanged();
    });
  }

  if (oauth) {
    return (
      <div style={{
        padding: 16, borderRadius: 12,
        background: "var(--success-bg)", border: "1px solid var(--success-border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <MicrosoftGlyph />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--success-fg)" }}>
                Connected — Microsoft
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-300)", fontFamily: "var(--font-mono)" }}>
                {oauth.accountEmail}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={connect} disabled={connecting} style={secondaryBtn}>
              {connecting ? "Reconnecting…" : "Reconnect"}
            </button>
            <button type="button" onClick={disconnect} disabled={disconnecting} style={dangerBtn}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
        {error && <InlineError>{error}</InlineError>}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={connect}
        disabled={connecting}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          padding: "14px 18px", fontSize: 15, fontWeight: 600,
          color: "var(--ink-100)", background: "var(--bg-card)",
          border: "1px solid var(--line-strong)", borderRadius: 12,
          cursor: connecting ? "default" : "pointer",
        }}
      >
        <MicrosoftGlyph />
        {connecting ? "Waiting for Microsoft…" : "Connect Microsoft 365 / Outlook"}
      </button>
      <p style={{ margin: "10px 2px 0", fontSize: 12.5, color: "var(--ink-400)", lineHeight: 1.5 }}>
        Sign in on Microsoft&rsquo;s site and approve once. No password or admin
        setup needed — recommended for Microsoft 365 and Outlook.com.
      </p>
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}

function MicrosoftGlyph() {
  // The Microsoft four-square mark.
  return (
    <span aria-hidden style={{ display: "inline-grid", gridTemplateColumns: "9px 9px", gap: 2 }}>
      <span style={{ width: 9, height: 9, background: "#F25022" }} />
      <span style={{ width: 9, height: 9, background: "#7FBA00" }} />
      <span style={{ width: 9, height: 9, background: "#00A4EF" }} />
      <span style={{ width: 9, height: 9, background: "#FFB900" }} />
    </span>
  );
}

/* ── Advanced: custom SMTP ─────────────────────────────────────────────── */

function AdvancedSmtp({ hasSmtp, onSaved }: { hasSmtp: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: 0, background: "transparent", border: "none",
          color: "var(--ink-200)", fontSize: 13.5, fontWeight: 600,
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-400)" }}>
            {open ? "▼" : "▶"}
          </span>
          Advanced — use a custom SMTP server
          {hasSmtp && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: "var(--success-fg)",
              background: "var(--success-bg)", border: "1px solid var(--success-border)",
              borderRadius: 6, padding: "1px 7px",
            }}>
              configured
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: "var(--ink-400)", fontFamily: "var(--font-mono)" }}>
          {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-400)", lineHeight: 1.55 }}>
            For Gmail (app password), Zoho, Yahoo, or your own mail server. Most
            Microsoft 365 mailboxes can&rsquo;t use SMTP — use the Connect
            Microsoft button above instead.
          </p>
          <SmtpForm onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}

function SmtpForm({ onSaved }: { onSaved: () => void }) {
  const [provider, setProvider] = useState<SmtpProvider>("gmail");
  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(465);
  const [secure, setSecure] = useState<"true" | "false">("true");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isOther = provider === "other";
  const preset = !isOther ? SMTP_PRESETS[provider] : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveSmtpCredentialsAction(fd);
      if (res?.error) setError(res.error);
      else onSaved();
    });
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 16 }}>
      <Field label="Mail provider">
        <select
          name="provider"
          value={provider}
          onChange={(e) => {
            const next = e.target.value as SmtpProvider;
            setProvider(next);
            setHelpOpen(false);
            if (next !== "other") {
              const p = SMTP_PRESETS[next];
              setHost(p.host);
              setPort(p.port);
              setSecure(p.secure ? "true" : "false");
            }
          }}
          style={inputStyle}
        >
          {SMTP_PROVIDER_CHOICES.map((key) => (
            <option key={key} value={key}>
              {key === "other" ? "Other / Custom SMTP" : SMTP_PRESETS[key].label}
            </option>
          ))}
        </select>
      </Field>

      {preset && (
        <div style={{
          padding: "10px 14px", background: "var(--bg-elev)",
          border: "1px solid var(--line)", borderRadius: 10,
          fontSize: 12.5, color: "var(--ink-300)",
          display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          <span>
            <span style={{ fontFamily: "var(--font-mono)" }}>{preset.host}</span>
            {" · port "}{preset.port}{" · "}{preset.secure ? "implicit TLS" : "STARTTLS"}
          </span>
          <a
            href={preset.appPasswordHelpUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            Need an app password? →
          </a>
        </div>
      )}

      {preset && (
        <div style={{
          border: "1px solid var(--line)", borderRadius: 10,
          background: "var(--bg-elev)", overflow: "hidden",
        }}>
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            aria-expanded={helpOpen}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", background: "transparent", border: "none",
              color: "var(--ink-200)", fontSize: 13, fontWeight: 600,
              cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-400)" }}>
                {helpOpen ? "▼" : "▶"}
              </span>
              How to get your {preset.label} app password
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-400)", fontFamily: "var(--font-mono)" }}>
              {helpOpen ? "hide" : "show"}
            </span>
          </button>

          {helpOpen && (
            <div style={{
              padding: "4px 18px 16px 18px", borderTop: "1px solid var(--line)",
              color: "var(--ink-200)", fontSize: 13.5, lineHeight: 1.6,
            }}>
              {preset.appPasswordGuide.askAdmin && (
                <AskAdminBlock
                  message={preset.appPasswordGuide.askAdmin.message}
                  providerLabel={preset.label}
                />
              )}
              <div style={{ marginTop: preset.appPasswordGuide.askAdmin ? 18 : 12 }}>
                <PathHeading icon="👤">
                  {preset.appPasswordGuide.askAdmin
                    ? "Or set it up yourself"
                    : "Set it up yourself"}
                </PathHeading>
                <ol style={{ margin: "10px 0 4px 18px", padding: 0, display: "grid", gap: 8 }}>
                  {preset.appPasswordGuide.diy.map((step, i) => (
                    <li key={i} style={{ paddingLeft: 4 }}>
                      {step.text}
                      {step.url && (
                        <>
                          {" "}
                          <a
                            href={step.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={openLinkStyle}
                          >
                            Open →
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
              <div style={{
                marginTop: 14, padding: "10px 14px",
                background: "var(--success-bg)", border: "1px solid var(--success-border)",
                borderRadius: 8, color: "var(--success-fg)", fontSize: 13, fontWeight: 600,
              }}>
                ✓ Paste the password in the Password field below. That&rsquo;s it.
              </div>
              <a
                href={preset.appPasswordHelpUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--ink-400)", textDecoration: "none", fontSize: 12, marginTop: 12, display: "inline-block" }}
              >
                {preset.label} official docs →
              </a>
            </div>
          )}
        </div>
      )}

      {isOther && (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 120px 160px" }}>
          <Field label="SMTP host">
            <input
              type="text" name="host" required
              placeholder="smtp.yourdomain.com"
              value={host} onChange={(e) => setHost(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Port">
            <input
              type="number" name="port" required min={1} max={65535}
              value={port} onChange={(e) => setPort(Number(e.target.value))}
              style={inputStyle}
            />
          </Field>
          <Field label="TLS mode">
            <select
              name="secure" value={secure}
              onChange={(e) => setSecure(e.target.value as "true" | "false")}
              style={inputStyle}
            >
              <option value="true">Implicit TLS (465)</option>
              <option value="false">STARTTLS (587)</option>
            </select>
          </Field>
        </div>
      )}

      <Field label="Username (mailbox login)">
        <input
          type="text" name="username" required autoComplete="username"
          placeholder="you@yourdomain.com"
          value={username} onChange={(e) => setUsername(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="Password (or app password)">
        <input
          type="password" name="password" required autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <Field label="From email">
          <input
            type="email" name="fromEmail" required
            placeholder="you@yourdomain.com"
            value={fromEmail} onChange={(e) => setFromEmail(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="From name (optional)">
          <input
            type="text" name="fromName"
            placeholder="Your Company"
            value={fromName} onChange={(e) => setFromName(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      {error && <InlineError>{error}</InlineError>}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save SMTP server"}
        </Button>
      </div>
    </form>
  );
}

/* ── shared bits ───────────────────────────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  background: "var(--bg-card)",
  color: "var(--ink-100)",
  border: "1px solid var(--line-strong)",
  borderRadius: 10,
  outline: "none",
};

const secondaryBtn: React.CSSProperties = {
  padding: "7px 12px", fontSize: 13, fontWeight: 600,
  color: "var(--ink-100)", background: "var(--bg-card)",
  border: "1px solid var(--line-strong)", borderRadius: 8, cursor: "pointer",
};

const dangerBtn: React.CSSProperties = {
  padding: "7px 12px", fontSize: 13, fontWeight: 600,
  color: "var(--error-fg)", background: "var(--error-bg)",
  border: "1px solid var(--error-border)", borderRadius: 8, cursor: "pointer",
};

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 12, color: "var(--error-fg)", padding: "10px 14px",
      background: "var(--error-bg)", border: "1px solid var(--error-border)",
      borderRadius: 10, fontSize: 13,
    }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{
        fontSize: 12, color: "var(--ink-400)", fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </label>
  );
}

const openLinkStyle: React.CSSProperties = {
  display: "inline-block",
  marginLeft: 4,
  padding: "1px 8px",
  fontSize: 11.5,
  fontFamily: "var(--font-mono)",
  color: "var(--accent)",
  background: "var(--accent-bg-soft)",
  border: "1px solid var(--accent-border-soft)",
  borderRadius: 6,
  textDecoration: "none",
  whiteSpace: "nowrap",
  verticalAlign: "baseline",
};

function PathHeading({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      fontSize: 13, fontWeight: 700, color: "var(--ink-100)",
      letterSpacing: "0.01em",
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      {children}
    </div>
  );
}

function AskAdminBlock({ message, providerLabel }: { message: string; providerLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <PathHeading icon="🧑‍💼">Not technical? Ask your IT admin</PathHeading>
      <div style={{
        marginTop: 10, padding: 12,
        background: "var(--bg-card)", border: "1px solid var(--line)",
        borderRadius: 8, position: "relative",
      }}>
        <pre style={{
          margin: 0, fontFamily: "var(--font-mono)", fontSize: 12.5,
          color: "var(--ink-200)", whiteSpace: "pre-wrap", lineHeight: 1.55,
        }}>{message}</pre>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button
            type="button"
            onClick={copy}
            aria-label={`Copy the ${providerLabel} admin message`}
            style={{
              padding: "5px 12px", fontSize: 12, fontWeight: 600,
              color: copied ? "var(--success-fg)" : "var(--ink-100)",
              background: copied ? "var(--success-bg)" : "var(--bg-elev)",
              border: `1px solid ${copied ? "var(--success-border)" : "var(--line-strong)"}`,
              borderRadius: 6, cursor: "pointer",
              fontFamily: "var(--font-mono)", letterSpacing: "0.02em",
            }}
          >
            {copied ? "✓ Copied" : "📋 Copy message"}
          </button>
        </div>
      </div>
    </div>
  );
}
