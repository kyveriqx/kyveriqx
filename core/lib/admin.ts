/* Admin gate — who may see /admin and call admin server actions.
   Admin is a single boolean on profiles (profiles.is_admin), seeded for the
   founder in 0008_admin_events_feedback.sql. Everything here runs server-side. */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase-server";

/** Does this user carry the admin flag? Reads profiles.is_admin. */
export async function isAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  return data?.is_admin === true;
}

/** Guard for admin surfaces. Redirects signed-out users to login (with a
 *  return path) and non-admins to the home page. Returns the admin user so
 *  callers can use user.id / user.email. */
export async function requireAdmin(): Promise<User> {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/admin");
  if (!(await isAdmin(supabase, user.id))) redirect("/");
  return user;
}
