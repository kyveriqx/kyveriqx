"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "../../../core/lib/supabase-server";
import { postAuthDefaultPath } from "../../../core/lib/subdomain";

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
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(`/auth/register?error=${encodeURIComponent(error.message)}${nextQs}`);
  }

  // If email confirmation is disabled in Supabase Auth settings, a session is
  // returned and the user is logged in immediately. If confirmation is on, the
  // user has to click the email link before logging in.
  if (data.session) {
    redirect(next ?? postAuthDefaultPath());
  }
  redirect(`/auth/register?ok=check-email${nextQs}`);
}
