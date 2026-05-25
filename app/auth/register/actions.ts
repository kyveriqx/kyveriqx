"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "../../../core/lib/supabase-server";

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/auth/register?error=missing");
  }

  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(`/auth/register?error=${encodeURIComponent(error.message)}`);
  }

  // If email confirmation is disabled in Supabase Auth settings, a session is
  // returned and the user is logged in immediately. If confirmation is on, the
  // user has to click the email link before logging in.
  if (data.session) {
    redirect("/store");
  }
  redirect("/auth/register?ok=check-email");
}
