/* POST /api/events — single ingress for client-side activity tracking.

   The client (core/lib/track.ts) sends only { type, toolId?, jobId?, path?,
   metadata? }. We resolve the user from the session here so the client can
   never spoof identity, validate the event type against the whitelist, then
   write via the service role (events has RLS on with no policies). */

import { NextResponse } from "next/server";
import { supabaseServer } from "../../../core/lib/supabase-server";
import { logEvent, EVENT_TYPES, type EventType } from "../../../core/lib/events";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    type?: string;
    toolId?: string;
    jobId?: string;
    path?: string;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.type || !EVENT_TYPES.includes(body.type as EventType)) {
    return NextResponse.json({ error: "invalid event type" }, { status: 400 });
  }

  // Identity comes from the session, never the request body.
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  await logEvent({
    type: body.type as EventType,
    userId: user?.id ?? null,
    toolId: body.toolId ?? null,
    jobId: body.jobId ?? null,
    path: body.path ?? null,
    metadata: body.metadata ?? {},
  });

  return NextResponse.json({ ok: true });
}
