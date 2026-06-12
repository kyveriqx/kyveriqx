"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../../core/lib/supabase-server";
import { logEvent } from "../../../core/lib/events";

/** Origin of the current request (correct on every subdomain and in dev),
 *  used to build the recovery link's redirect target. Mirrors register. */
function requestOrigin(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") || host.includes("lvh.me") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function forgotAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect(`/auth/forgot?error=missing`);
  }

  const supabase = supabaseServer();
  // The recovery email's link lands on /auth/confirm (which verifies the
  // one-time token and writes the session cookie), then forwards to
  // /auth/reset where the user picks a new password.
  const redirectTo = `${requestOrigin()}/auth/confirm?next=${encodeURIComponent("/auth/reset")}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    redirect(`/auth/forgot?error=${encodeURIComponent(error.message)}`);
  }

  await logEvent({ type: "password_reset_requested", userId: null, path: "/auth/forgot" });

  // Always report success regardless of whether the address exists, so the
  // page can't be used to probe which emails are registered.
  redirect(`/auth/forgot?ok=sent`);
}
