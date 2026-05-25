/* Trigger.dev client — Architecture §8.5.
   Every tool has one job; jobs write results back to Supabase
   so the browser polls Supabase, not Trigger.dev directly. */

export type TriggerConfig = {
  secretKey: string;
  projectId: string;
};

export function triggerConfig(): TriggerConfig {
  const secretKey = process.env.TRIGGER_SECRET_KEY;
  const projectId = process.env.TRIGGER_PROJECT_ID;
  if (!secretKey || !projectId) {
    throw new Error("Missing TRIGGER_SECRET_KEY / TRIGGER_PROJECT_ID");
  }
  return { secretKey, projectId };
}

/* Real triggering happens via the @trigger.dev/sdk once Step 5 begins.
 * Per-tool jobs live at /tools/<sub>/jobs/<name>.ts. */
