/* Shared upload-related types — Architecture §8.4.

   Every tool's upload + preview + generate routes pass these shapes
   around. They live in core/ so a new tool's wizard / API route can
   import the canonical declaration instead of redeclaring it inline. */

/** Browser-visible record returned by POST /api/uploads (or a per-tool
 *  equivalent). `blobUrl` is the `supabase:<uploadRowId>` magic marker
 *  the preview + generate routes recognise to look up the storage path
 *  via the service role. */
export type UploadedFile = {
  id: string;
  filename: string;
  size: number;
  blobUrl: string;
  uploadedAt: string;
};

/** Anything-goes file map used by tool wizards that group uploads by
 *  section (e.g. orgmis has gl/sales/purchase/inventory/...). Each
 *  section can hold either a single UploadedFile or an array. */
export type FileMap = Partial<Record<string, UploadedFile[] | UploadedFile>>;
