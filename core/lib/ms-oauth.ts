/* Microsoft identity-platform OAuth — emailcampaign "Connect Microsoft".

   The user signs in on Microsoft's own site (never on ours) and grants the
   delegated Graph `Mail.Send` scope. We keep the refresh token (encrypted)
   and mint a short-lived access token at send time, then send each campaign
   email through the Graph API `POST /me/sendMail`. Graph sending does NOT use
   SMTP, so it sidesteps the per-mailbox "Authenticated SMTP" wall that makes
   the password path unusable on Microsoft 365.

   Auth flow: OAuth 2.0 Authorization Code + PKCE against the `/common`
   endpoint, so both work/school (Entra) and personal Microsoft accounts can
   connect. Client id/secret live only on the server; the worker reads the
   same two env vars to refresh tokens.

   App registration (one-time, in Microsoft Entra):
     - Multitenant + personal accounts
     - Delegated Graph permissions: Mail.Send, offline_access, openid, email,
       profile, User.Read
     - Redirect URIs: https://emailcampaign.kyveriqx.com/api/oauth/microsoft/callback
       and http://localhost:3000/api/oauth/microsoft/callback
   Env: MS_OAUTH_CLIENT_ID, MS_OAUTH_CLIENT_SECRET. */

import { createHash, randomBytes } from "node:crypto";

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH_SENDMAIL = "https://graph.microsoft.com/v1.0/me/sendMail";

/** `offline_access` is what gets us a refresh token; `Mail.Send` is the send
 *  grant; the openid/email/profile trio lets us read which mailbox connected. */
export const MS_SCOPES =
  "openid email profile offline_access https://graph.microsoft.com/Mail.Send User.Read";

function clientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MS_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "MS_OAUTH_CLIENT_ID / MS_OAUTH_CLIENT_SECRET are not set. Register the " +
        "app in Microsoft Entra and add both to the environment.",
    );
  }
  return { clientId, clientSecret };
}

// ── PKCE + state helpers ──────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random high-entropy PKCE verifier (RFC 7636). */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256 challenge derived from the verifier. */
export function codeChallengeFromVerifier(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** Opaque anti-CSRF state value, matched against the value stashed in the cookie. */
export function generateState(): string {
  return base64url(randomBytes(16));
}

// ── Authorize URL ─────────────────────────────────────────────────────────

export function buildAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const { clientId } = clientCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    response_mode: "query",
    scope: MS_SCOPES,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    // Always show the account picker so a user can pick which mailbox to connect.
    prompt: "select_account",
  });
  return `${AUTHORITY}/authorize?${params.toString()}`;
}

// ── Token exchange / refresh ───────────────────────────────────────────────

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  scope?: string;
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json()) as TokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(`Microsoft token request failed: ${detail}`);
  }
  return json;
}

export type ConnectedAccount = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  accountEmail: string;
  displayName: string | null;
  scope: string | null;
};

/** Exchange the authorization code (with the PKCE verifier) for tokens, and
 *  read the connected mailbox identity out of the id_token. */
export async function exchangeCodeForTokens(opts: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<ConnectedAccount> {
  const { clientId, clientSecret } = clientCreds();
  const json = await tokenRequest(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
      scope: MS_SCOPES,
    }),
  );
  if (!json.refresh_token) {
    throw new Error(
      "Microsoft did not return a refresh token — make sure the app requests the offline_access scope.",
    );
  }
  const claims = decodeIdToken(json.id_token);
  const accountEmail = claims.email || claims.preferred_username;
  if (!accountEmail) {
    throw new Error("Could not determine the connected mailbox address from Microsoft.");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    accountEmail,
    displayName: claims.name ?? null,
    scope: json.scope ?? null,
  };
}

/** Mint a fresh access token from a stored refresh token. Microsoft may
 *  rotate the refresh token; when it does, the caller should persist the new
 *  one. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number }> {
  const { clientId, clientSecret } = clientCreds();
  const json = await tokenRequest(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MS_SCOPES,
    }),
  );
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in,
  };
}

// ── Graph sendMail ─────────────────────────────────────────────────────────

/** Send one HTML email through the connected mailbox via Graph. Throws on a
 *  non-2xx response with the Graph error text so the caller can record a
 *  per-recipient failure. Graph returns 202 Accepted on success. */
export async function sendMailViaGraph(opts: {
  accessToken: string;
  accountEmail: string;
  fromName: string | null;
  to: string;
  subject: string;
  html: string;
  /** Fixed addresses CC'd/BCC'd on every send (optional). */
  cc?: string[];
  bcc?: string[];
}): Promise<void> {
  const message: Record<string, unknown> = {
    subject: opts.subject,
    body: { contentType: "HTML", content: opts.html },
    toRecipients: [{ emailAddress: { address: opts.to } }],
  };
  // Fixed CC/BCC, applied to every message. Omitted entirely when empty so
  // callers that don't set them are unaffected.
  if (opts.cc?.length) {
    message.ccRecipients = opts.cc.map((a) => ({ emailAddress: { address: a } }));
  }
  if (opts.bcc?.length) {
    message.bccRecipients = opts.bcc.map((a) => ({ emailAddress: { address: a } }));
  }
  // A display-name override is only honoured when paired with the mailbox's
  // own address (no SendAs needed for that case).
  if (opts.fromName) {
    message.from = { emailAddress: { address: opts.accountEmail, name: opts.fromName } };
  }

  const res = await fetch(GRAPH_SENDMAIL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) detail = err.error.message;
    } catch {
      // body not JSON — keep the status code
    }
    throw new Error(detail);
  }
}

// ── internal ───────────────────────────────────────────────────────────────

type IdTokenClaims = {
  email?: string;
  preferred_username?: string;
  name?: string;
};

/** Decode (without verifying) the id_token payload. The token came straight
 *  from Microsoft's token endpoint over TLS in the same request, so we trust
 *  it for reading the email/name claims; we don't use it for authorization. */
function decodeIdToken(idToken: string | undefined): IdTokenClaims {
  if (!idToken) return {};
  const parts = idToken.split(".");
  if (parts.length < 2) return {};
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload) as IdTokenClaims;
  } catch {
    return {};
  }
}
