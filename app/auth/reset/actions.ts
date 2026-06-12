"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "../../../core/lib/supabase-server";
import { postAuthDefaultPath } from "../../../core/lib/subdomain";
import { logEvent } from "../../../core/lib/events";

export async function resetPasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!password || !confirm) {
    redirect(`/auth/reset?error=missing`);
  }
  if (password.length < 6) {
    redirect(`/auth/reset?error=${encodeURIComponent("Password must be at least 6 characters.")}`);
  }
  if (password !== confirm) {
    redirect(`/auth/reset?error=${encodeURIComponent("Passwords do not match.")}`);
  }

  const supabase = supabaseServer();

  // The recovery link already established a session via /auth/confirm, so a
  // plain updateUser swaps in the new password. Without that session this
  // returns an auth error, which we surface.
  const { data, error } = await supabase.auth.updateUser({ password });

  if (error) {
    const message = /auth session missing|not authenticated/i.test(error.message)
      ? "Your reset link has expired. Request a new one."
      : error.message;
    redirect(`/auth/reset?error=${encodeURIComponent(message)}`);
  }

  await logEvent({ type: "password_reset_completed", userId: data.user?.id ?? null, path: "/auth/reset" });

  redirect(postAuthDefaultPath());
}
