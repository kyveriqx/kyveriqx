/* Shared helper used by every tool's Trigger.dev job — Architecture §8.5.
   Marks the Supabase `jobs` row as running, executes the tool-specific
   work function, then writes the result (or error) back.
   The browser polls the row, never talks to Trigger.dev directly. */

import { createClient } from "@supabase/supabase-js";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
};

const supabaseAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

export async function runJob<P extends Payload, R extends object>(
  payload: P,
  work: (payload: P) => Promise<R>,
): Promise<R> {
  const supa = supabaseAdmin();
  const now = () => new Date().toISOString();

  await supa.from("jobs").update({ status: "running", updated_at: now() }).eq("id", payload.jobId);

  try {
    const result = await work(payload);
    const { error } = await supa
      .from("jobs")
      .update({ status: "succeeded", result, updated_at: now() })
      .eq("id", payload.jobId);
    if (error) throw new Error(`Supabase update failed: ${error.message}`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supa
      .from("jobs")
      .update({ status: "failed", error: message, updated_at: now() })
      .eq("id", payload.jobId);
    throw err;
  }
}
