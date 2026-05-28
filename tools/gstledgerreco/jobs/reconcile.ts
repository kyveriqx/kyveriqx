/* GST ledger reconciliation — Trigger.dev task.
   Downloads every uploaded file, dispatches each to the JSON or XLSX
   parser, merges per side, runs the matcher, and writes the
   GstReconcileResult into the jobs row via runJob. */

import { logger, task } from "@trigger.dev/sdk";
import { runJob } from "../../../core/lib/job-runner";
import { downloadSupabaseUploadNamed } from "../../../core/lib/supabase-uploads";
import { STORAGE_BUCKETS } from "../../../core/lib/storage-buckets";
import { parseGstr1Json, parseGstr2aJson, parseGstr2bJson, looksLikeJson } from "../lib/parse-gst-json";
import { parsePurchaseRegister, parseSalesRegister, mergeInvoices } from "../lib/parse-register";
import { reconcileGst } from "../lib/match";
import { DEFAULT_OPTIONS } from "../lib/types";
import type { FileSource, GstInvoice, GstReconcileOptions, GstReconcileResult, GstReturn } from "../lib/types";

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  gstr1UploadIds?: string[];
  gstr2aUploadIds?: string[];
  gstr2bUploadIds: string[];
  salesUploadIds?: string[];
  purchaseUploadIds: string[];
  options?: Partial<GstReconcileOptions>;
};

const BUCKET = STORAGE_BUCKETS.ledgerUploads;

async function fetchNamed(uploadId: string, label: string): Promise<{ filename: string; buffer: Buffer }> {
  const got = await downloadSupabaseUploadNamed(`supabase:${uploadId}`, BUCKET);
  if (!got) throw new Error(`could not download ${label} (upload ${uploadId})`);
  return got;
}

type PortalParser = (buf: Buffer, filename: string) => { invoices: GstInvoice[]; notes: string[] };
type RegisterParser = (buf: Buffer, filename: string) => { invoices: GstInvoice[]; columns: Record<string, string | null> };

/** Download + parse one "side" of portal inputs (GSTR-1/2A/2B). Each file
 *  is dispatched to either the JSON parser or — when the portal exported
 *  XLSX instead of JSON — handled by the matching XLSX register parser
 *  (the portal's XLSX has gstin / invoice no / value columns that the
 *  fuzzy header matcher recognises). */
async function loadPortalSide(
  uploadIds: string[] | undefined,
  source: GstReturn,
  jsonParser: PortalParser,
  label: string,
): Promise<{ merged: GstInvoice[]; sources: FileSource[]; notes: string[] }> {
  if (!uploadIds || uploadIds.length === 0) return { merged: [], sources: [], notes: [] };
  const files = await Promise.all(uploadIds.map((id) => fetchNamed(id, label)));
  const parsedParts: Array<{ file: string; invoices: GstInvoice[] }> = [];
  const notes: string[] = [];
  for (const f of files) {
    if (looksLikeJson(f.buffer)) {
      const r = jsonParser(f.buffer, f.filename);
      parsedParts.push({ file: f.filename, invoices: r.invoices });
      notes.push(...r.notes);
    } else {
      // Portal XLSX or user-converted CSV — re-use the register parser
      // and re-tag the source after the fact.
      const r = parsePurchaseRegister(f.buffer, f.filename);
      const retagged = r.invoices.map((inv) => ({ ...inv, source }));
      parsedParts.push({ file: f.filename, invoices: retagged });
      if (r.invoices.length === 0) {
        notes.push(`${f.filename}: no rows parsed from ${label} XLSX/CSV. Check column headers.`);
      }
    }
  }
  const { merged, sources } = mergeInvoices(parsedParts);
  return { merged, sources, notes };
}

async function loadRegisterSide(
  uploadIds: string[] | undefined,
  parser: RegisterParser,
  label: string,
): Promise<{ merged: GstInvoice[]; sources: FileSource[]; columns: Record<string, string | null>; notes: string[] }> {
  if (!uploadIds || uploadIds.length === 0) {
    return { merged: [], sources: [], columns: {}, notes: [] };
  }
  const files = await Promise.all(uploadIds.map((id) => fetchNamed(id, label)));
  const parts: Array<{ file: string; invoices: GstInvoice[] }> = [];
  const notes: string[] = [];
  let columns: Record<string, string | null> = {};
  for (const f of files) {
    const r = parser(f.buffer, f.filename);
    parts.push({ file: f.filename, invoices: r.invoices });
    if (!Object.keys(columns).length) columns = r.columns;
    if (r.invoices.length === 0) {
      notes.push(`${f.filename}: no rows parsed from ${label}. Check that the column headers include GSTIN, Invoice No, Invoice Date, and Taxable Value.`);
    }
  }
  const { merged, sources } = mergeInvoices(parts);
  return { merged, sources, columns, notes };
}

export const gstReconcile = task({
  id: "gst-ledger-reconcile",
  maxDuration: 1800,
  run: (payload: Payload) =>
    runJob(payload, async (p): Promise<GstReconcileResult> => {
      const opts: GstReconcileOptions = { ...DEFAULT_OPTIONS, ...(p.options ?? {}) };
      logger.info("starting GST reconciliation", {
        jobId: p.jobId,
        gstr1Files: p.gstr1UploadIds?.length ?? 0,
        gstr2aFiles: p.gstr2aUploadIds?.length ?? 0,
        gstr2bFiles: p.gstr2bUploadIds.length,
        salesFiles: p.salesUploadIds?.length ?? 0,
        purchaseFiles: p.purchaseUploadIds.length,
        opts,
      });

      const [gstr1, gstr2a, gstr2b, sales, purchase] = await Promise.all([
        loadPortalSide(p.gstr1UploadIds, "gstr1", parseGstr1Json, "GSTR-1"),
        loadPortalSide(p.gstr2aUploadIds, "gstr2a", parseGstr2aJson, "GSTR-2A"),
        loadPortalSide(p.gstr2bUploadIds, "gstr2b", parseGstr2bJson, "GSTR-2B"),
        loadRegisterSide(p.salesUploadIds, parseSalesRegister, "Sales Register"),
        loadRegisterSide(p.purchaseUploadIds, parsePurchaseRegister, "Purchase Register"),
      ]);

      const reco = reconcileGst({
        gstr1: gstr1.merged,
        gstr2a: gstr2a.merged,
        gstr2b: gstr2b.merged,
        sales: sales.merged,
        purchase: purchase.merged,
        options: opts,
      });

      const result: GstReconcileResult = {
        ...reco,
        sources: {
          gstr1: gstr1.sources,
          gstr2a: gstr2a.sources,
          gstr2b: gstr2b.sources,
          sales: sales.sources,
          purchase: purchase.sources,
        },
        purchaseColumns: purchase.columns,
        salesColumns: sales.columns,
        notes: [
          ...gstr1.notes,
          ...gstr2a.notes,
          ...gstr2b.notes,
          ...sales.notes,
          ...purchase.notes,
        ],
      };

      logger.info("GST reconciliation done", {
        jobId: p.jobId,
        itcMatched: result.summary.itcMatched,
        itcExceptions: result.itcExceptions.length,
        itcTaxAtRisk: result.summary.itcTaxAtRisk,
        salesMatched: result.summary.salesMatched,
        salesExceptions: result.salesExceptions.length,
      });

      return result;
    }),
});
