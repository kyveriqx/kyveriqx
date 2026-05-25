/* Server-side Supabase client — Architecture §8.4.
   Uses @supabase/ssr so the session cookie is read/written
   correctly inside Server Components, Route Handlers and Server Actions. */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // In a Server Component this throws (cookies are read-only there);
          // callers that need to set cookies (Server Actions, Route Handlers)
          // run in contexts where this works. Swallow the read-only error.
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // no-op
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // no-op
          }
        },
      },
    },
  );
}
