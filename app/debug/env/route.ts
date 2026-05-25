/* Temporary diagnostic — reports env-var presence without exposing values.
   Same pattern used in Step 3A. Remove after Trigger env vars are verified. */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const peek = (s: string | undefined) => {
    if (!s) return { present: false };
    return { present: true, length: s.length, head: s.slice(0, 12), tail: s.slice(-6) };
  };
  return NextResponse.json({
    NEXT_PUBLIC_SUPABASE_URL: peek(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: peek(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: peek(process.env.SUPABASE_SERVICE_ROLE_KEY),
    TRIGGER_SECRET_KEY: peek(process.env.TRIGGER_SECRET_KEY),
    TRIGGER_PROJECT_REF: peek(process.env.TRIGGER_PROJECT_REF),
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
}
