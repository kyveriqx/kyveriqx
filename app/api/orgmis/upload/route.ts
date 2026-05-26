/* POST /api/orgmis/upload — accepts one Excel file + section name, writes
   to the Supabase Storage `orgmis-uploads` bucket, inserts an `uploads`
   row, and returns the BOD MIS-shaped `UploadedFile` so the existing
   Zustand store works unchanged.

   The `blobUrl` field is `supabase:<uploadRowId>` — a magic marker the
   preview + generate APIs recognise to look up the storage_path and
   download the file via the service role. Avoids exposing raw signed
   URLs in the browser store. */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../core/lib/supabase-server";
import { supabaseAdmin } from "../../../../core/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB per file (BOD MIS limit)
const BUCKET = "orgmis-uploads";

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const file = form.get("file");
  const section = String(form.get("section") ?? "unknown").replace(/[^\w-]/g, "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }

  const admin = supabaseAdmin();

  const { data: tool, error: toolErr } = await admin
    .from("tools").select("id").eq("slug", "orgmis").maybeSingle();
  if (toolErr || !tool) {
    return NextResponse.json({ error: "tool record missing" }, { status: 500 });
  }

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${user.id}/${id}-${section}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
      upsert: false,
    });
  if (upErr) {
    return NextResponse.json(
      { error: `storage upload failed: ${upErr.message}` }, { status: 500 },
    );
  }

  const { data: row, error: rowErr } = await admin
    .from("uploads")
    .insert({
      user_id: user.id,
      tool_id: tool.id,
      storage_path: storagePath,
      filename: file.name,
      size_bytes: file.size,
    })
    .select("id")
    .single();
  if (rowErr || !row) {
    await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return NextResponse.json(
      { error: `recording upload failed: ${rowErr?.message ?? "no row"}` },
      { status: 500 },
    );
  }

  // Shape matches BOD MIS UploadedFile type so the existing store + UI work.
  return NextResponse.json({
    id: row.id,
    filename: file.name,
    size: file.size,
    blobUrl: `supabase:${row.id}`,
    uploadedAt: new Date().toISOString(),
  });
}
