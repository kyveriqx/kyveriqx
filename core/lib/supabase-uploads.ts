/* `supabase:<uploadRowId>` URL resolution — Architecture §8.4.

   The upload routes write files to private Storage buckets and hand
   the browser back a `blobUrl` of the form `supabase:<row id>`. The
   preview + generate routes recognise that marker and look up the
   real storage_path via the service-role client. Centralising the two
   resolution paths here means a new tool doesn't have to invent its
   own copy. */

import { supabaseAdmin } from "./supabase";

const PREFIX = "supabase:";

/** Resolve a `supabase:<id>` marker to a short-lived signed URL that
 *  external workers (Trigger.dev) can `fetch()`. Returns null if the
 *  marker is malformed, the row is missing, or signing fails.
 *  Legacy / regular http(s) URLs are passed through unchanged. */
export async function resolveSupabaseUploadToSignedUrl(
  blobUrl: string | undefined,
  bucket: string,
  ttlSeconds: number,
): Promise<string | null> {
  if (!blobUrl) return null;
  if (!blobUrl.startsWith(PREFIX)) return blobUrl;

  const uploadId = blobUrl.slice(PREFIX.length);
  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("uploads")
    .select("storage_path")
    .eq("id", uploadId)
    .maybeSingle();
  if (!row?.storage_path) return null;

  const { data: signed, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(row.storage_path, ttlSeconds);
  if (error || !signed?.signedUrl) return null;
  return signed.signedUrl;
}

/** Resolve a `supabase:<id>` marker to a Buffer downloaded via the
 *  service role. Used by inline preview routes that parse the file
 *  in-process. Returns null on any failure path. */
export async function downloadSupabaseUpload(
  blobUrl: string | undefined,
  bucket: string,
): Promise<Buffer | null> {
  if (!blobUrl) return null;

  if (blobUrl.startsWith(PREFIX)) {
    const uploadId = blobUrl.slice(PREFIX.length);
    const admin = supabaseAdmin();
    const { data: row } = await admin
      .from("uploads")
      .select("storage_path")
      .eq("id", uploadId)
      .maybeSingle();
    if (!row?.storage_path) return null;
    const { data: blob } = await admin.storage.from(bucket).download(row.storage_path);
    if (!blob) return null;
    return Buffer.from(await blob.arrayBuffer());
  }

  // Fallback: regular fetchable URL (legacy clients).
  try {
    const r = await fetch(blobUrl);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}
