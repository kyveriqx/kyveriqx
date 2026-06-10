/* Completes the "Connect Microsoft" OAuth flow.

   Microsoft redirects the popup back here with ?code & ?state. We validate
   state against the cookie set by ../start, exchange the code (with the PKCE
   verifier) for tokens, encrypt the refresh token, and upsert the connection
   into user_mail_oauth (RLS-scoped via the user's session).

   Because the flow runs in a popup, we don't navigate anywhere — we return a
   tiny HTML page that postMessages the result to the opener (the setup card)
   and closes itself. The opener then refreshes into its connected state. */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../core/lib/supabase-server";
import { exchangeCodeForTokens } from "../../../../../core/lib/ms-oauth";
import { encryptSecret } from "../../../../../core/lib/smtp-crypto";
import { OAUTH_TX_COOKIE } from "../start/route";

export const dynamic = "force-dynamic";

type Tx = { state: string; codeVerifier: string };

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError =
    url.searchParams.get("error_description") || url.searchParams.get("error");

  if (providerError) return closingPage(url.origin, { ok: false, error: humanize(providerError) });

  const txRaw = req.cookies.get(OAUTH_TX_COOKIE)?.value;
  if (!code || !state || !txRaw) {
    return closingPage(url.origin, { ok: false, error: "Sign-in was cancelled or timed out. Please try again." });
  }

  let tx: Tx;
  try {
    tx = JSON.parse(txRaw) as Tx;
  } catch {
    return closingPage(url.origin, { ok: false, error: "Something went wrong starting sign-in. Please try again." });
  }
  if (!tx.state || tx.state !== state) {
    return closingPage(url.origin, { ok: false, error: "Security check failed (state mismatch). Please try again." });
  }

  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return closingPage(url.origin, { ok: false, error: "Your session expired. Please sign in again, then reconnect." });
  }

  try {
    const redirectUri = `${url.origin}/api/oauth/microsoft/callback`;
    const account = await exchangeCodeForTokens({ code, codeVerifier: tx.codeVerifier, redirectUri });

    const { ciphertext, iv } = encryptSecret(account.refreshToken);
    const { error } = await supabase.from("user_mail_oauth").upsert(
      {
        user_id: user.id,
        provider: "microsoft",
        account_email: account.accountEmail,
        display_name: account.displayName,
        // Postgres bytea accepts \x-prefixed hex over the wire (same as 0007).
        refresh_token_enc: `\\x${ciphertext.toString("hex")}`,
        refresh_token_iv: `\\x${iv.toString("hex")}`,
        scope: account.scope,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      return closingPage(url.origin, { ok: false, error: `Could not save the connection: ${error.message}` });
    }
    return closingPage(url.origin, { ok: true, email: account.accountEmail });
  } catch (err) {
    return closingPage(url.origin, {
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed. Please try again.",
    });
  }
}

type Result = { ok: true; email: string } | { ok: false; error: string };

/** Render a self-closing HTML page that reports the result to the opener via
 *  postMessage (scoped to our own origin) and clears the transaction cookie. */
function closingPage(origin: string, result: Result): NextResponse {
  // Serialize safely so a Graph error message can't break out of the <script>.
  const payload = JSON.stringify({ type: "ms-oauth", ...result }).replace(/</g, "\\u003c");
  const heading = result.ok ? "Connected ✓" : "Connection failed";
  const note = result.ok
    ? "You can close this window."
    : escapeHtml(result.error);

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${heading}</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;color:#1f2937">
<script>
(function () {
  try { if (window.opener) window.opener.postMessage(${payload}, ${JSON.stringify(origin)}); } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} }, 150);
})();
</script>
<h3 style="margin:0 0 8px">${heading}</h3>
<p style="margin:0;color:#6b7280">${note}</p>
</body>
</html>`;

  const res = new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  // One-shot transaction — clear it regardless of outcome.
  res.cookies.set(OAUTH_TX_COOKIE, "", { path: "/api/oauth/microsoft", maxAge: 0 });
  return res;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Microsoft error_description strings are verbose and code-prefixed; show a
 *  shorter, friendlier line. */
function humanize(raw: string): string {
  // Org requires a one-time admin approval for the app (common for unverified
  // multitenant apps). Tell the user exactly what to do.
  if (/AADSTS90094|AADSTS65001|admin/i.test(raw)) {
    return "Your Microsoft organization requires a one-time admin approval for this app. Ask your IT admin to approve it, then connect again.";
  }
  if (/AADSTS65004|consent/i.test(raw)) return "Sign-in was declined (consent not granted).";
  if (/AADSTS50058|interaction_required/i.test(raw)) return "Sign-in didn't complete. Please try again.";
  return raw.split(/[\r\n]/)[0].slice(0, 200);
}
