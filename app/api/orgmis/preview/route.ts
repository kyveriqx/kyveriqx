/* POST /api/orgmis/preview — parses the uploaded Excel files into the
   live KPI dashboard data (drives Step 3 of the wizard).

   Body: { gl, sales?, purchase?, inventory?, budget?, customerAging?,
           vendorAging?, period }
   Each section value is a `blobUrl` (or list of `blobUrl`s) of the form
   "supabase:<uploadRowId>" — we resolve those back to storage paths and
   download via the service-role client. */

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../core/lib/supabase-server";
import { supabaseAdmin } from "../../../../core/lib/supabase";
import { analyze } from "@orgmis/lib/financials";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "orgmis-uploads";

async function downloadBuffer(blobUrl: string): Promise<Buffer | undefined> {
  if (!blobUrl) return undefined;

  if (blobUrl.startsWith("supabase:")) {
    const uploadId = blobUrl.slice("supabase:".length);
    const admin = supabaseAdmin();
    const { data: row } = await admin
      .from("uploads")
      .select("storage_path")
      .eq("id", uploadId)
      .maybeSingle();
    if (!row?.storage_path) return undefined;
    const { data: blob } = await admin.storage.from(BUCKET).download(row.storage_path);
    if (!blob) return undefined;
    return Buffer.from(await blob.arrayBuffer());
  }

  // Fallback: regular fetchable URL
  try {
    const r = await fetch(blobUrl);
    if (!r.ok) return undefined;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return undefined;
  }
}

async function downloadAll(input: unknown): Promise<Buffer[]> {
  if (!input) return [];
  const urls = Array.isArray(input)
    ? input.filter((u): u is string => typeof u === "string")
    : typeof input === "string" ? [input] : [];
  const bufs = await Promise.all(urls.map(downloadBuffer));
  return bufs.filter((b): b is Buffer => !!b);
}

function normalizeFY(p: string | undefined): string {
  if (!p) return "FY24-25";
  const digits = p.match(/\d{2,4}/g) ?? [];
  if (digits.length >= 2) {
    const a = (digits[0] ?? "").slice(-2);
    const b = (digits[1] ?? "").slice(-2);
    return `FY${a}-${b}`;
  }
  return "FY24-25";
}

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const body = await req.json();
    const { gl, sales, purchase, inventory, budget, customerAging, vendorAging, period } = body;

    if (!gl || (Array.isArray(gl) && gl.length === 0)) {
      return NextResponse.json({ error: "GL/Trial Balance required" }, { status: 400 });
    }

    const [glBufs, salesBufs, purBufs, invBufs, budBufs, custAgingBufs, vendAgingBufs] =
      await Promise.all([
        downloadAll(gl),
        downloadAll(sales),
        downloadAll(purchase),
        downloadAll(inventory),
        downloadAll(budget),
        downloadAll(customerAging),
        downloadAll(vendorAging),
      ]);

    if (glBufs.length === 0) {
      return NextResponse.json(
        { error: "Could not read GL file(s). Please re-upload." },
        { status: 400 },
      );
    }

    const analysis = analyze(
      {
        glBuffers: glBufs,
        salesBuffers: salesBufs,
        purchaseBuffers: purBufs,
        inventoryBuffers: invBufs,
        budgetBuffers: budBufs,
        customerAgingBuffers: custAgingBufs,
        vendorAgingBuffers: vendAgingBufs,
      },
      normalizeFY(period),
    );

    return NextResponse.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
