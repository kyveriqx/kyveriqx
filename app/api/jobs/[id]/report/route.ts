/* GET /api/jobs/[id]/report — download the styled Excel reconciliation
   report for a finished Org Ledger Reconciliation job.

   Auth-gated via Supabase session (RLS scopes the `jobs` read to the
   owning user). We rebuild the workbook from jobs.result on each download
   rather than persisting it in Storage — v1 keeps storage costs out. */

import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../../core/lib/supabase-server";
import { buildReport } from "../../../../../core/lib/ledger/build-report";
import type { ReconcileResult } from "../../../../../core/lib/ledger/types";
import { buildBankReport } from "../../../../../tools/bankledgerreco/lib/build-report";
import type { BankReconcileResult } from "../../../../../tools/bankledgerreco/lib/types";
import { buildGstReport } from "../../../../../tools/gstledgerreco/lib/build-report";
import type { GstReconcileResult } from "../../../../../tools/gstledgerreco/lib/types";
import { logEvent } from "../../../../../core/lib/events";

export const dynamic = "force-dynamic";

/** Tools that can emit a styled Excel report, keyed by job_key. */
const REPORT_FILENAME: Record<string, string> = {
  "org-ledger-reconcile": "ledger-reconciliation",
  "bank-ledger-reconcile": "bank-reconciliation",
  "gst-ledger-reconcile": "gst-reconciliation",
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, result, job_key, tool_id")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!REPORT_FILENAME[data.job_key]) {
    return NextResponse.json({ error: "report not available for this tool" }, { status: 400 });
  }
  if (data.status !== "succeeded" || !data.result) {
    return NextResponse.json({ error: "job is not yet complete" }, { status: 409 });
  }

  const buffer =
    data.job_key === "gst-ledger-reconcile"
      ? await buildGstReport(data.result as GstReconcileResult)
      : data.job_key === "bank-ledger-reconcile"
        ? await buildBankReport(data.result as BankReconcileResult)
        : await buildReport(data.result as ReconcileResult);

  await logEvent({
    type: "report_download",
    userId: user.id,
    toolId: (data.tool_id as string | null) ?? null,
    jobId: data.id as string,
    path: `/api/jobs/${params.id}/report`,
    metadata: { job_key: data.job_key, format: "xlsx" },
  });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        `attachment; filename="${REPORT_FILENAME[data.job_key]}-${data.id.slice(0, 8)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
