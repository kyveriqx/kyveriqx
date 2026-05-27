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
import { getToolId } from "../../core/lib/tools";
import { runReconciliationPipeline } from "../../core/lib/ledger/run-pipeline";
import { loginHrefWithReturn } from "../../core/lib/subdomain";

export async function runOrgReconcileAction(formData: FormData) {
  const companyUploadId = String(formData.get("companyUploadId") ?? "");
  const partnerUploadId = String(formData.get("partnerUploadId") ?? "");
  if (!companyUploadId || !partnerUploadId) {
    throw new Error("Both files must be uploaded before running.");
  }

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginHrefWithReturn());

  const toolId = await getToolId(supabaseAdmin(), "orgledgerreco");
  if (!toolId) throw new Error("tools lookup failed for slug=orgledgerreco");

  const { jobId } = await runReconciliationPipeline({
    companyUploadId,
    partnerUploadId,
    userId: user.id,
    toolId,
  });

  redirect(`/tools/orgledgerreco?jobId=${jobId}`);
}
