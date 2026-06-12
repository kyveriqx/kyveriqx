/* Activity log writer (server-only) — Architecture §8.6 companion to entitlement.

   events captures what the existing tables can't: visits, tool opens, and
   whether a finished report was viewed vs. downloaded. Report runs, durations,
   and errors already live in `jobs`, so we never duplicate those here.

   Writes go through the service role (supabaseAdmin) because public.events has
   RLS on with no policies — it is intentionally invisible to clients. logEvent
   never throws: a tracking failure must not break the user flow that triggered
   it, so we swallow and (in dev) log. */

import { supabaseAdmin } from "./supabase";

export type EventType =
  | "visit"
  | "tool_open"
  | "report_view"
  | "report_download"
  | "login"
  | "signup"
  | "password_reset_requested"
  | "password_reset_completed";

export const EVENT_TYPES: EventType[] = [
  "visit",
  "tool_open",
  "report_view",
  "report_download",
  "login",
  "signup",
  "password_reset_requested",
  "password_reset_completed",
];

export type LogEventInput = {
  type: EventType;
  userId?: string | null;
  toolId?: string | null;
  jobId?: string | null;
  path?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    const admin = supabaseAdmin();
    await admin.from("events").insert({
      type: input.type,
      user_id: input.userId ?? null,
      tool_id: input.toolId ?? null,
      job_id: input.jobId ?? null,
      path: input.path ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    // Non-fatal: never let analytics break a real request.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[events] logEvent failed:", err);
    }
  }
}
