/* Begin the "Connect Microsoft" OAuth flow.

   Opened inside a popup window by the emailcampaign setup card. We require a
   signed-in user, mint a PKCE verifier + anti-CSRF state, stash both in a
   short-lived httpOnly cookie, and redirect the popup to Microsoft's login.
   The matching callback route reads the cookie back to complete the exchange. */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../core/lib/supabase-server";
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from "../../../../../core/lib/ms-oauth";
import { OAUTH_TX_COOKIE, OAUTH_TX_PATH } from "../../../../../core/lib/ms-oauth-cookie";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // No session in the popup — bounce to login; the user can retry the connect.
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/oauth/microsoft/callback`;

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeFromVerifier(codeVerifier);

  const res = NextResponse.redirect(buildAuthorizeUrl({ state, codeChallenge, redirectUri }));
  res.cookies.set(OAUTH_TX_COOKIE, JSON.stringify({ state, codeVerifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent on the top-level GET redirect back from Microsoft
    path: OAUTH_TX_PATH,
    maxAge: 600, // 10 minutes to complete sign-in
  });
  return res;
}
