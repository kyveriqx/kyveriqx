"use server";

/* User feedback submission — reviews, bug reports, and new-tool requests.
   One action serves the /feedback page and the per-tool "Report an issue"
   widget. Insert is RLS-scoped to the signed-in user (policy in
   0008_admin_events_feedback.sql); the tool is resolved from its slug so a
   tool-scoped issue links back to the right catalogue row. */

import { supabaseServer } from "../../core/lib/supabase-server";
import { getToolId } from "../../core/lib/tools";

export type FeedbackKind = "review" | "issue" | "tool_request";

export type SubmitFeedbackInput = {
  kind: FeedbackKind;
  body: string;
  subject?: string;
  rating?: number | null;
  toolSlug?: string | null;
};

export type SubmitFeedbackResult = { ok: true } | { ok: false; error: string };

export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<SubmitFeedbackResult> {
  const kind = input.kind;
  if (kind !== "review" && kind !== "issue" && kind !== "tool_request") {
    return { ok: false, error: "Invalid feedback type." };
  }

  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "Please write a message." };

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in to send feedback." };

  let toolId: string | null = null;
  if (input.toolSlug) toolId = await getToolId(supabase, input.toolSlug);

  const rating =
    kind === "review" && input.rating != null
      ? Math.max(1, Math.min(5, Math.round(input.rating)))
      : null;

  const { error } = await supabase.from("feedback").insert({
    user_id: user.id,
    tool_id: toolId,
    kind,
    rating,
    subject: input.subject?.trim() || null,
    body,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
