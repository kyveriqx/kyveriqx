/* POST /api/orgmis/generate — kicks off the BOD report generation pipeline.

   1. Validates the session
   2. Resolves each `blobUrl` ("supabase:<id>") into a signed download
      URL the Trigger.dev worker can fetch from outside Vercel
   3. Inserts a `jobs` row (status=queued)
   4. Fires the `orgmis-generate-report` Trigger.dev task with the resolved
      file URLs + branding + outlook payload
   5. Returns { jobId } for the page to poll /api/jobs/[id] */

import { NextRequest, NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import { supabaseServer } from "../../../../core/lib/supabase-server";
import { supabaseAdmin } from "../../../../core/lib/supabase";
import type { orgmisGenerateReport } from "../../../../tools/orgmis/jobs/generate-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "orgmis-uploads";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — task usually finishes in 30-60s

type UploadedFile = {
  id?: string;
  filename?: string;
  size?: number;
  blobUrl?: string;
  uploadedAt?: string;
};

type FileMap = Partial<Record<string, UploadedFile[] | UploadedFile>>;

async function resolveToSignedUrls(items: UploadedFile[] | UploadedFile | undefined): Promise<string[]> {
  if (!items) return [];
  const list = Array.isArray(items) ? items : [items];
  const admin = supabaseAdmin();
  const urls: string[] = [];

  for (const it of list) {
    const blobUrl = it?.blobUrl;
    if (!blobUrl) continue;

    if (blobUrl.startsWith("supabase:")) {
      const uploadId = blobUrl.slice("supabase:".length);
      const { data: row } = await admin
        .from("uploads")
        .select("storage_path")
        .eq("id", uploadId)
        .maybeSingle();
      if (!row?.storage_path) continue;

      const { data: signed, error } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
      if (!error && signed?.signedUrl) urls.push(signed.signedUrl);
    } else {
      // Legacy / external URL — pass through
      urls.push(blobUrl);
    }
  }
  return urls;
}

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: tool, error: toolErr } = await admin
    .from("tools").select("id").eq("slug", "orgmis").maybeSingle();
  if (toolErr || !tool) {
    return NextResponse.json({ error: "tool record missing" }, { status: 500 });
  }

  try {
    // Body shape is dictated by the client — we just pass branding/outlook
    // straight through to the Trigger.dev task, which is typed to receive
    // them as Branding/Outlook. Trust the client (page is auth-gated).
    const payload = await req.json();
    const { branding, files, outlook } = payload as {
      branding: any;
      files: FileMap;
      outlook: any;
    };

    const gl = await resolveToSignedUrls(files?.glOrTrialBalance);
    if (gl.length === 0) {
      return NextResponse.json(
        { error: "At least one GL/Trial Balance file is required" },
        { status: 400 },
      );
    }

    const fileUrls = {
      gl,
      sales: await resolveToSignedUrls(files?.sales),
      purchase: await resolveToSignedUrls(files?.purchase),
      inventory: await resolveToSignedUrls(files?.inventory),
      budget: await resolveToSignedUrls(files?.budget),
      customerAging: await resolveToSignedUrls(files?.customerAging),
      vendorAging: await resolveToSignedUrls(files?.vendorAging),
    };

    const { data: job, error: jobErr } = await admin
      .from("jobs")
      .insert({
        user_id: user.id,
        tool_id: tool.id,
        job_key: "orgmis-generate-report",
        status: "queued",
        payload: { /* opaque — task gets the real payload via trigger() */ },
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      return NextResponse.json(
        { error: `failed to create job: ${jobErr?.message ?? "no row"}` },
        { status: 500 },
      );
    }

    await tasks.trigger<typeof orgmisGenerateReport>("orgmis-generate-report", {
      jobId: job.id,
      userId: user.id,
      toolId: tool.id,
      branding,
      files: fileUrls,
      outlook,
    });

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
