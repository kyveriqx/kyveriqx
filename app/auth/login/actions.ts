"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "../../../core/lib/supabase-server";
import { postAuthDefaultPath } from "../../../core/lib/subdomain";

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
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/auth/login?error=${encodeURIComponent(error.message)}${nextQs}`);
  }

  redirect(next ?? postAuthDefaultPath());
}
