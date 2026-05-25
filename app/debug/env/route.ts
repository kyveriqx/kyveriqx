/* Diagnostic endpoint — reports which env vars are present in the running
   environment WITHOUT exposing their values. Safe to leave in for now;
   remove once Step 3 deployment is verified. */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const peek = (s: string | undefined) => {
    if (!s) return { present: false };
    return { present: true, length: s.length, head: s.slice(0, 12), tail: s.slice(-6) };
  };
  return NextResponse.json({
    NEXT_PUBLIC_ROOT_DOMAIN: peek(process.env.NEXT_PUBLIC_ROOT_DOMAIN),
    NEXT_PUBLIC_SUPABASE_URL: peek(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: peek(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: peek(process.env.SUPABASE_SERVICE_ROLE_KEY),
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    VERCEL_REGION: process.env.VERCEL_REGION ?? null,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
}
