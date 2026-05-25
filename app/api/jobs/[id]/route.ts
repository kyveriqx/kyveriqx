/* GET /api/jobs/[id] — returns the current state of a job for polling.
   Reads via the user's session (RLS scoped to auth.uid()) so a user can
   never read someone else's job. */

import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../core/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, result, error, updated_at, job_key")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(data);
}
