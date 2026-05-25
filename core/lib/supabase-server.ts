/* Server-side Supabase client — Architecture §8.4.
   Uses @supabase/ssr so the session cookie is read/written correctly inside
   Server Components, Route Handlers, and Server Actions.

   Cookies are scoped to `.<NEXT_PUBLIC_ROOT_DOMAIN>` in production so a user
   who signs in on kyveriqx.com stays signed in on every tool subdomain
   (gstledgerreco.kyveriqx.com, etc.). In dev they fall back to per-host
   cookies (lvh.me + localhost). */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

function cookieDomainForProduction(): string | undefined {
  if (process.env.NODE_ENV !== "production") return undefined;
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  return root ? `.${root}` : undefined;
}

export function supabaseServer() {
  const cookieStore = cookies();
  const domain = cookieDomainForProduction();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options, domain });
          } catch {
            // read-only in Server Components — Server Actions / Route Handlers can write
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options, domain });
          } catch {
            // no-op
          }
        },
      },
    },
  );
}
