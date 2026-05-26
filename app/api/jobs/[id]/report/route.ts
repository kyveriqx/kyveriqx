/* GET /api/jobs/[id]/report — download the styled Excel reconciliation
   report for a finished Org Ledger Reconciliation job.

   Auth-gated via Supabase session (RLS scopes the `jobs` read to the
   owning user). We rebuild the workbook from jobs.result on each download
   rather than persisting it in Storage — v1 keeps storage costs out. */

import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../../core/lib/supabase-server";
import { buildReport } from "../../../../../core/lib/ledger/build-report";
import type { ReconcileResult } from "../../../../../core/lib/ledger/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, result, job_key")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (data.job_key !== "org-ledger-reconcile") {
    return NextResponse.json({ error: "report not available for this tool" }, { status: 400 });
  }
  if (data.status !== "succeeded" || !data.result) {
    return NextResponse.json({ error: "job is not yet complete" }, { status: 409 });
  }

  const buffer = await buildReport(data.result as ReconcileResult);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        `attachment; filename="ledger-reconciliation-${data.id.slice(0, 8)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
