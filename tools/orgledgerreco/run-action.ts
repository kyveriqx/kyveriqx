"use server";

/* Server action — run an inter-entity ledger reconciliation inline.

   Unlike most tools in this codebase, Org Ledger Reconciliation does NOT
   route through Trigger.dev. The matcher runs in ~500ms so the queue +
   cold-start + polling overhead cost more than the work. We download
   both files, parse, match, and write the completed jobs row all inside
   this request, then redirect to the result page where it renders
   server-side without polling.

   See plan: switch from queued to inline execution. */

import { redirect } from "next/navigation";
import { supabaseServer } from "../../core/lib/supabase-server";
import { supabaseAdmin } from "../../core/lib/supabase";
import { runReconciliationPipeline } from "../../core/lib/ledger/run-pipeline";

export async function runOrgReconcileAction(formData: FormData) {
  const companyUploadId = String(formData.get("companyUploadId") ?? "");
  const partnerUploadId = String(formData.get("partnerUploadId") ?? "");
  if (!companyUploadId || !partnerUploadId) {
    throw new Error("Both files must be uploaded before running.");
  }

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: tool, error: toolErr } = await supabaseAdmin()
    .from("tools")
    .select("id")
    .eq("slug", "orgledgerreco")
    .maybeSingle();
  if (toolErr || !tool) throw new Error(`tools lookup failed: ${toolErr?.message ?? "no row"}`);

  const { jobId } = await runReconciliationPipeline({
    companyUploadId,
    partnerUploadId,
    userId: user.id,
    toolId: tool.id,
  });

  redirect(`/tools/orgledgerreco?jobId=${jobId}`);
}
