"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "../../../core/lib/supabase-server";
import { postAuthDefaultPath } from "../../../core/lib/subdomain";
import { logEvent } from "../../../core/lib/events";

function safeNext(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  const nextQs = next ? `&next=${encodeURIComponent(next)}` : "";

  if (!email || !password) {
    redirect(`/auth/login?error=missing${nextQs}`);
  }

  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Supabase returns "Email not confirmed" when confirmation is on and the
    // user hasn't clicked the link yet — surface clearer guidance.
    const message = /email not confirmed/i.test(error.message)
      ? "Please confirm your email first — check your inbox for the confirmation link."
      : error.message;
    redirect(`/auth/login?error=${encodeURIComponent(message)}${nextQs}`);
  }

  await logEvent({ type: "login", userId: data.user?.id ?? null, path: "/auth/login" });

  redirect(next ?? postAuthDefaultPath());
}
