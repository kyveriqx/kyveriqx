/* Parsers for the GST portal's JSON exports.

   Schemas (truncated to the fields v1 cares about):

   GSTR-2B (download from "Returns Dashboard → GSTR-2B → Download JSON"):
     {
       data: {
         rtnprd:  "042026",
         gstin:   "<receiver gstin>",
         docdata: {
           b2b: [{
             ctin:  "<supplier gstin>",
             trdnm: "<supplier name>",
             supfildt: "<DD-MM-YYYY filing date>",
             inv: [{
               inum:   "<invoice no>",
               dt:     "<DD-MM-YYYY invoice date>",
               val:    invoice value,
               txval:  taxable value,
               iamt:   IGST, camt: CGST, samt: SGST, csamt: cess,
               itcavl: "Y" | "N",
               rsn:    "<ineligibility reason, when itcavl=N>",
             }],
           }],
         },
       },
     }

   GSTR-2A (downloaded as JSON or rolled up via the GSTN public API):
     { b2b: [{ ctin, inv: [{ inum, idt, val, txval, iamt, camt, samt, csamt, ... }] }] }
     (`idt` instead of `dt`; no `itcavl` — every line is "filed", eligibility
      is decided by 2B's cutoff.)

   GSTR-1 (the user's own outward supply, downloaded as JSON):
     { gstin, fp: "042026", b2b: [{ ctin, inv: [{ inum, idt, val, pos, ..., itms: [{ itm_det: { txval, rt, iamt, camt, samt, csamt } }] }] }] }
     (`val` is the invoice total; per-line tax amounts live inside `itms[].itm_det`,
      which we sum.)

   Anything not under `b2b` (b2cl, exp, cdnr, …) is out of scope for v1 — the
   ITC reco only operates on B2B inward / outward invoices because that's
   where credit and matching obligations actually exist. */

import type { GstInvoice, GstReturn } from "./types";
import { normalizeGstin } from "./types";

/** Parse a Buffer of JSON bytes. Returns null + a note when JSON parsing
 *  fails, so the caller can keep parsing other inputs. */
function safeParse(buffer: Buffer): { json: unknown; note: string | null } {
  try {
    return { json: JSON.parse(buffer.toString("utf8")), note: null };
  } catch (e) {
    return { json: null, note: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** DD-MM-YYYY (GSTN's canonical format) → Date in UTC.
 *  Also accepts DD/MM/YYYY and YYYY-MM-DD just in case. */
export function parseGstnDate(s: unknown): Date | null {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  let m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(str);
  return isNaN(dt.getTime()) ? null : dt;
}

function num(v: unknown): number {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[,\s₹]/g, ""));
  return isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** Walk to a nested key path; returns undefined if any hop is missing.
 *  Tolerates the portal sometimes putting b2b at `data.docdata.b2b` and
 *  sometimes at `data.b2b` or even root `b2b`. */
function pick(obj: unknown, paths: string[][]): unknown {
  for (const path of paths) {
    let cur: any = obj;
    let ok = true;
    for (const k of path) {
      if (cur != null && typeof cur === "object" && k in cur) cur = cur[k];
      else { ok = false; break; }
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

type B2bGroup = {
  ctin?: string;
  trdnm?: string;
  supfildt?: string;
  inv?: Array<Record<string, unknown>>;
};

/** Locate the `b2b` array regardless of which envelope the export uses. */
function findB2b(json: unknown): B2bGroup[] {
  const candidates: string[][] = [
    ["data", "docdata", "b2b"],
    ["data", "b2b"],
    ["docdata", "b2b"],
    ["b2b"],
  ];
  const found = pick(json, candidates);
  return Array.isArray(found) ? (found as B2bGroup[]) : [];
}

/** Common per-invoice extraction. The portal uses `dt` on 2B and `idt`
 *  on 2A / GSTR-1 — we accept either. */
function readInvoiceCore(
  inv: Record<string, unknown>,
): {
  invoiceNo: string;
  invoiceDate: Date | null;
  invoiceValue: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
} {
  return {
    invoiceNo: str(inv.inum),
    invoiceDate: parseGstnDate(inv.dt ?? inv.idt),
    invoiceValue: num(inv.val),
    taxableValue: num(inv.txval),
    igst: num(inv.iamt),
    cgst: num(inv.camt),
    sgst: num(inv.samt),
    cess: num(inv.csamt),
  };
}

/** GSTR-1's per-invoice tax lives in `itms[].itm_det.{txval,iamt,camt,samt,csamt}`.
 *  Each itm is one HSN line; we sum them to invoice-level. */
function summariseGstr1Items(itms: unknown): {
  taxableValue: number; igst: number; cgst: number; sgst: number; cess: number;
} {
  const sum = { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  if (!Array.isArray(itms)) return sum;
  for (const it of itms) {
    const det = (it as any)?.itm_det ?? {};
    sum.taxableValue += num(det.txval);
    sum.igst += num(det.iamt);
    sum.cgst += num(det.camt);
    sum.sgst += num(det.samt);
    sum.cess += num(det.csamt);
  }
  return sum;
}

type ParseResult = { invoices: GstInvoice[]; notes: string[] };

function flatten(
  source: GstReturn,
  filename: string,
  b2bGroups: B2bGroup[],
  isGstr1: boolean,
): GstInvoice[] {
  const out: GstInvoice[] = [];
  let row = 0;
  for (const group of b2bGroups) {
    const partyGstin = normalizeGstin(str(group.ctin));
    const partyName = str(group.trdnm);
    const filedAt = parseGstnDate(group.supfildt);
    for (const inv of group.inv ?? []) {
      row += 1;
      const core = readInvoiceCore(inv);
      const items = isGstr1 ? summariseGstr1Items((inv as any).itms) : null;
      const taxableValue = items?.taxableValue || core.taxableValue;
      const igst = items?.igst ?? core.igst;
      const cgst = items?.cgst ?? core.cgst;
      const sgst = items?.sgst ?? core.sgst;
      const cess = items?.cess ?? core.cess;
      const totalTax = igst + cgst + sgst + cess;
      const itcAvl = str((inv as any).itcavl).toUpperCase();
      out.push({
        row,
        file: filename,
        fileRow: row,
        source,
        partyGstin,
        partyName,
        invoiceNo: core.invoiceNo,
        invoiceDate: core.invoiceDate,
        taxableValue,
        igst,
        cgst,
        sgst,
        cess,
        totalTax,
        invoiceValue: core.invoiceValue || taxableValue + totalTax,
        itcEligible: source === "gstr2b" ? (itcAvl === "Y" ? true : itcAvl === "N" ? false : null) : null,
        itcReason: source === "gstr2b" ? (str((inv as any).rsn) || null) : null,
        filedAt,
      });
    }
  }
  return out;
}

export function parseGstr2bJson(buffer: Buffer, filename: string): ParseResult {
  const { json, note } = safeParse(buffer);
  if (json == null) return { invoices: [], notes: note ? [`${filename}: ${note}`] : [] };
  const b2b = findB2b(json);
  if (b2b.length === 0) {
    return { invoices: [], notes: [`${filename}: no B2B section found in GSTR-2B JSON.`] };
  }
  return { invoices: flatten("gstr2b", filename, b2b, false), notes: [] };
}

export function parseGstr2aJson(buffer: Buffer, filename: string): ParseResult {
  const { json, note } = safeParse(buffer);
  if (json == null) return { invoices: [], notes: note ? [`${filename}: ${note}`] : [] };
  const b2b = findB2b(json);
  if (b2b.length === 0) {
    return { invoices: [], notes: [`${filename}: no B2B section found in GSTR-2A JSON.`] };
  }
  return { invoices: flatten("gstr2a", filename, b2b, false), notes: [] };
}

export function parseGstr1Json(buffer: Buffer, filename: string): ParseResult {
  const { json, note } = safeParse(buffer);
  if (json == null) return { invoices: [], notes: note ? [`${filename}: ${note}`] : [] };
  const b2b = findB2b(json);
  if (b2b.length === 0) {
    return { invoices: [], notes: [`${filename}: no B2B section found in GSTR-1 JSON.`] };
  }
  return { invoices: flatten("gstr1", filename, b2b, true), notes: [] };
}

/** True iff the buffer looks like a JSON document (`{` / `[` after BOM /
 *  whitespace). The Trigger.dev task uses this to dispatch each portal
 *  upload to the JSON parser; non-JSON files fall through to the XLSX
 *  branch, which handles the portal's Excel export. */
export function looksLikeJson(buffer: Buffer): boolean {
  let i = 0;
  // Skip UTF-8 BOM and whitespace.
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) i = 3;
  while (i < buffer.length && (buffer[i] === 0x20 || buffer[i] === 0x09 || buffer[i] === 0x0a || buffer[i] === 0x0d)) i++;
  return i < buffer.length && (buffer[i] === 0x7b /* { */ || buffer[i] === 0x5b /* [ */);
}
