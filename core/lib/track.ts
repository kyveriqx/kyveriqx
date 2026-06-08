/* Client-side activity tracker. Fire-and-forget POST to /api/events, which
   attaches the user identity server-side (we never trust the client for who
   the user is). Use `keepalive` so the beacon survives a navigation/unload.

   Only the gaps the DB can't see are tracked from the client: report_view and
   client-side CSV downloads. Excel downloads and tool opens are logged
   server-side (see app/api/jobs/[id]/report and app/tools/layout). */

"use client";

import type { EventType } from "./events";

export function track(
  type: EventType,
  data?: { toolId?: string; jobId?: string; metadata?: Record<string, unknown> },
): void {
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        type,
        toolId: data?.toolId,
        jobId: data?.jobId,
        path: typeof window !== "undefined" ? window.location.pathname : undefined,
        metadata: data?.metadata,
      }),
    }).catch(() => {});
  } catch {
    // never throw from a tracking call
  }
}
