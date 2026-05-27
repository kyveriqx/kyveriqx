/* POST /api/uploads — server-side file upload to Supabase Storage.

   Accepts multipart/form-data with:
     file:     the File to upload
     toolSlug: which tool's bucket-path namespace to use (e.g. "orgledgerreco")
     kind:     short tag included in the storage path ("company" | "partner" | ...)

   Auth is enforced via the user's session cookie (supabaseServer). The actual
   Storage upload + uploads-row insert uses the service-role client
   (supabaseAdmin) so we don't need RLS policies on storage.objects — the
   trusted server is the only writer. */

import { NextResponse } from "next/server";
import { supabaseServer } from "../../../core/lib/supabase-server";
import { supabaseAdmin } from "../../../core/lib/supabase";
import { getToolId } from "../../../core/lib/tools";
import { UPLOAD_BUCKET_BY_TOOL_SLUG } from "../../../core/lib/storage-buckets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // Node runtime — large multipart bodies, file APIs

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — match the upload-form cap

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const file = form.get("file");
  const toolSlug = String(form.get("toolSlug") ?? "").trim();
  const kind = String(form.get("kind") ?? "file").trim().replace(/[^\w-]/g, "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (!toolSlug) {
    return NextResponse.json({ error: "missing toolSlug" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file is larger than ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    );
  }

  const admin = supabaseAdmin();

  const toolId = await getToolId(admin, toolSlug);
  if (!toolId) {
    return NextResponse.json(
      { error: `unknown tool: ${toolSlug}` },
      { status: 400 },
    );
  }
  const bucket = UPLOAD_BUCKET_BY_TOOL_SLUG[toolSlug];
  if (!bucket) {
    return NextResponse.json(
      { error: `no upload bucket configured for tool: ${toolSlug}` },
      { status: 400 },
    );
  }

  // Compose storage path. Keep userId namespacing — even though RLS isn't
  // gating this path anymore, scoping by user keeps the bucket browsable
  // and bounds blast-radius if we ever flip a policy on by accident.
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${user.id}/${id}-${kind}-${safeName}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json(
      { error: `storage upload failed: ${upErr.message}` },
      { status: 500 },
    );
  }

  const { data: row, error: rowErr } = await admin
    .from("uploads")
    .insert({
      user_id: user.id,
      tool_id: toolId,
      storage_path: storagePath,
      filename: file.name,
      size_bytes: file.size,
    })
    .select("id")
    .single();
  if (rowErr || !row) {
    // Best-effort cleanup of the uploaded object so we don't leave orphans
    await admin.storage.from(bucket).remove([storagePath]).catch(() => {});
    return NextResponse.json(
      { error: `recording upload failed: ${rowErr?.message ?? "no row"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id: row.id,
    filename: file.name,
    sizeBytes: file.size,
  });
}
