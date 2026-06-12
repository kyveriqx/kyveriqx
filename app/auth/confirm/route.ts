import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "../../../core/lib/supabase-server";
import { postAuthDefaultPath } from "../../../core/lib/subdomain";

function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

// Target of the email confirmation link. Supabase appends `token_hash` and
// `type`; we verify the one-time token, which writes the session cookie (scoped
// to `.kyveriqx.com` via supabaseServer), then send the user on their way.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // PKCE flow (the Supabase default) sends the user back with a one-time `code`
  // instead of a token_hash — e.g. recovery links built from the stock
  // {{ .ConfirmationURL }} email template. Support both so the route works
  // regardless of how the email template is configured.
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next")) ?? postAuthDefaultPath();

  const supabase = supabaseServer();

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/auth/login?error=link-expired", origin));
}
