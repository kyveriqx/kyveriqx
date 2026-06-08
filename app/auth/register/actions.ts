"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../../core/lib/supabase-server";
import { postAuthDefaultPath } from "../../../core/lib/subdomain";
import { logEvent } from "../../../core/lib/events";

/** Origin of the current request (correct on every subdomain and in dev),
 *  used to build the email confirmation link's redirect target. */
function requestOrigin(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") || host.includes("lvh.me") ? "http" : "https");
  return `${proto}://${host}`;
}

function safeNext(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const nextQs = next ? `&next=${encodeURIComponent(next)}` : "";

  if (!email || !password) {
    redirect(`/auth/register?error=missing${nextQs}`);
  }

  const supabase = supabaseServer();
  const emailRedirectTo = `${requestOrigin()}/auth/confirm${
    next ? `?next=${encodeURIComponent(next)}` : ""
  }`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  });

  if (error) {
    redirect(`/auth/register?error=${encodeURIComponent(error.message)}${nextQs}`);
  }

  await logEvent({ type: "signup", userId: data.user?.id ?? null, path: "/auth/register" });

  // If email confirmation is disabled in Supabase Auth settings, a session is
  // returned and the user is logged in immediately. If confirmation is on, the
  // user has to click the email link before logging in.
  if (data.session) {
    redirect(next ?? postAuthDefaultPath());
  }
  redirect(`/auth/register?ok=check-email${nextQs}`);
}
