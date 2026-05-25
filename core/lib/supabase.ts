/* Supabase clients — Architecture §8.4.
   Two flavors: browser client (anon key, RLS-respecting) and
   server client (service role, for server-only operations). */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

let browser: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient {
  if (!URL || !ANON) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (!browser) browser = createClient(URL, ANON);
  return browser;
}

export function supabaseAdmin(): SupabaseClient {
  if (!URL || !SERVICE) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (server only)");
  }
  // No singleton — each server caller gets a fresh client to avoid leaking session.
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}
