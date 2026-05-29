"use client";

/* SMTP setup form — shown when the user has no row in
   user_smtp_credentials yet, or when they re-open the tool to update
   their credentials.

   Provider dropdown:
     - Gmail / Office 365 / Zoho / Outlook.com / Yahoo — host/port/secure
       are hidden, resolved from SMTP_PRESETS server-side.
     - Other — host / port / TLS-mode fields are revealed for manual
       entry.

   Every preset shows a small "Need an app password?" link to the
   provider's official help page, since most of them require an app
   password (not the user's normal account password). */

import { useState, useTransition } from "react";
import { Button } from "../../../core/ui/button";
import { Card } from "../../../core/ui/card";
import {
  SMTP_PRESETS,
  SMTP_PROVIDER_ORDER,
  type SmtpProvider,
} from "../../../core/lib/smtp-presets";
import { saveSmtpCredentialsAction } from "../save-smtp-action";

type Props = {
  /** True when a credentials row already exists — used for the heading copy. */
  hasExisting: boolean;
};

export function SmtpSetupCard({ hasExisting }: Props) {
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
      try {
        await saveSmtpCredentialsAction(fd);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card style={{ padding: 28, maxWidth: 720 }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-400)",
        letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        Step 0 — SMTP setup
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 6px", color: "var(--ink-100)" }}>
        {hasExisting ? "Update your SMTP credentials" : "Connect your mailbox"}
      </h2>
      <p style={{ color: "var(--ink-300)", fontSize: 14, margin: "0 0 22px", lineHeight: 1.55 }}>
        Pick your mail provider, then sign in with the same mailbox you want
        campaigns sent <em>from</em>. We never store your password in plaintext —
        it&apos;s encrypted at rest and only decrypted when sending.
      </p>

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
            {SMTP_PROVIDER_ORDER.map((key) => (
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
                <ol style={{ margin: "12px 0 14px 18px", padding: 0, display: "grid", gap: 8 }}>
                  {preset.appPasswordSteps.map((step, i) => (
                    <li key={i} style={{ paddingLeft: 4 }}>{step}</li>
                  ))}
                </ol>
                <a
                  href={preset.appPasswordHelpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}
                >
                  Open {preset.label}&rsquo;s official docs →
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

        {error && (
          <div style={{
            color: "var(--error-fg)", padding: "10px 14px",
            background: "var(--error-bg)", border: "1px solid var(--error-border)",
            borderRadius: 10, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : hasExisting ? "Update credentials" : "Save credentials"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

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
