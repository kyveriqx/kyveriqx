/* Management / BOD MIS Generator — Trigger.dev v4 task.

   Runs the Python pipeline (analyze → MIS workbook → BOD deck → PDF
   convert) and uploads the three outputs to Supabase Storage. The
   browser polls /api/jobs/[id] to watch progress.

   Architecture: file generation takes ~30-60 seconds, well over Vercel's
   10s function limit, so unlike orgledgerreco this tool DOES route
   through Trigger.dev. */

import { task, logger } from "@trigger.dev/sdk";
import { python } from "@trigger.dev/python";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { runJob } from "../../../core/lib/job-runner";
import { STORAGE_BUCKETS } from "../../../core/lib/storage-buckets";

type Branding = {
  companyName: string;
  tagline: string;
  vision?: string;
  logoDataUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  reportingPeriod: string;
  preparedFor: string;
};

type FileUrls = {
  gl: string[];
  sales?: string[];
  purchase?: string[];
  inventory?: string[];
  budget?: string[];
  customerAging?: string[];
  vendorAging?: string[];
};

type Outlook = unknown;

type Payload = {
  jobId: string;
  userId: string;
  toolId: string;
  branding: Branding;
  files: FileUrls;
  outlook: Outlook;
};

const OUTPUTS_BUCKET = STORAGE_BUCKETS.orgmisOutputs;
const OUTPUT_SIGNED_URL_TTL = 24 * 60 * 60; // 24 hours

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

async function downloadTo(url: string, target: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url}: HTTP ${r.status}`);
  await fs.writeFile(target, Buffer.from(await r.arrayBuffer()));
}

/** Pick the first URL out of an array (the Python pipeline takes one
 *  file per section, not many — the upload UI allows multiple files
 *  but for v1 we only consume the first). */
function firstOf(urls?: string[]): string | undefined {
  return urls && urls.length > 0 ? urls[0] : undefined;
}

async function uploadOutput(localPath: string, storagePath: string): Promise<string | undefined> {
  try {
    const buf = await fs.readFile(localPath);
    const supa = admin();
    const { error: upErr } = await supa.storage
      .from(OUTPUTS_BUCKET)
      .upload(storagePath, buf, { upsert: true, cacheControl: "3600" });
    if (upErr) {
      logger.warn(`upload failed: ${upErr.message}`, { storagePath });
      return undefined;
    }
    const { data: signed, error: signErr } = await supa.storage
      .from(OUTPUTS_BUCKET)
      .createSignedUrl(storagePath, OUTPUT_SIGNED_URL_TTL);
    if (signErr || !signed?.signedUrl) {
      logger.warn(`signing failed: ${signErr?.message}`, { storagePath });
      return undefined;
    }
    return signed.signedUrl;
  } catch (err) {
    logger.warn(`uploadOutput threw`, { err: String(err) });
    return undefined;
  }
}

export const orgmisGenerateReport = task({
  id: "orgmis-generate-report",
  maxDuration: 600,
  run: (payload: Payload) =>
    runJob(payload, async (p) => {
      const { branding, files, outlook } = p;
      const runId = randomUUID();
      const workdir = path.join(os.tmpdir(), `orgmis-${runId}`);
      await fs.mkdir(workdir, { recursive: true });

      logger.info("starting BOD report generation", {
        jobId: p.jobId,
        company: branding.companyName,
        runId,
      });

      // 1) Download input files (first one per section).
      const inputs: Record<string, string> = {};
      const downloads: Array<Promise<void>> = [];
      const fileMap: Array<[keyof FileUrls, string]> = [
        ["gl", "gl_entry.xlsx"],
        ["sales", "sales.xlsx"],
        ["purchase", "purchase.xlsx"],
        ["inventory", "inventory.xlsx"],
        ["budget", "budget.xlsx"],
        ["customerAging", "customer_aging.xlsx"],
        ["vendorAging", "vendor_aging.xlsx"],
      ];
      for (const [key, filename] of fileMap) {
        const url = firstOf(files[key] as string[] | undefined);
        if (!url) continue;
        const target = path.join(workdir, filename);
        inputs[key] = target;
        downloads.push(downloadTo(url, target));
      }
      await Promise.all(downloads);
      logger.info("downloaded inputs", { files: Object.keys(inputs) });

      // 2) Write branding + outlook config for the Python scripts.
      const configPath = path.join(workdir, "config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({ branding, outlook, files: inputs }, null, 2),
      );

      // 3) Run Python pipeline (analyzer + MIS workbook + BOD deck in one
      //    Python process — xlsx + deck builders run concurrently inside).
      //    See tools/orgmis/python/pipeline.py for the orchestration logic.
      const scriptDir = path.join(process.cwd(), "tools", "orgmis", "python");
      const env = { BOD_MIS_CONFIG: configPath, BOD_MIS_WORKDIR: workdir };

      logger.info("running pipeline (analyze → xlsx + pptx)");
      const pipelineRes = await python.runScript(
        path.join(scriptDir, "pipeline.py"), [], { env },
      );
      if (pipelineRes.exitCode !== 0) {
        // Script's stderr is already captured in the Trigger.dev run trace
        // — no need to re-include it here (typed Result from tinyexec
        // doesn't expose stderr at this layer).
        throw new Error(`pipeline failed (exitCode=${pipelineRes.exitCode})`);
      }

      // 4) Locate outputs.
      const xlsxPath = path.join(workdir, "MIS.xlsx");
      const pptxPath = path.join(workdir, "BOD_Presentation.pptx");
      const pdfPath = path.join(workdir, "BOD_Presentation.pdf");

      // 5) Run PDF conversion concurrently with the xlsx + pptx uploads —
      //    they're independent (uploads only need the xlsx/pptx that already
      //    exist on disk; PDF only needs the pptx, which it reads via path).
      //    Saves min(pdf_time, upload_time) of wall clock vs the old serial
      //    "convert PDF, then upload all three" flow.
      const safeCompany = (branding.companyName || "report")
        .replace(/[^a-zA-Z0-9]/g, "_")
        .slice(0, 40);
      const stamp = new Date().toISOString().slice(0, 10);
      const prefix = `${p.userId}/${stamp}/${safeCompany}-${runId.slice(0, 8)}`;

      const pdfReadyPromise = python
        .runScript(
          path.join(scriptDir, "convert_pdf.py"),
          [pptxPath, pdfPath],
          { env: { BOD_MIS_WORKDIR: workdir } },
        )
        .then((conv) => {
          if (conv.exitCode !== 0) {
            logger.warn("PDF conversion failed, continuing without PDF", {
              exitCode: conv.exitCode,
            });
            return false;
          }
          return true;
        })
        .catch((e) => {
          logger.warn("PDF conversion threw, continuing without PDF", {
            err: String(e),
          });
          return false;
        });

      const [pptxUrl, xlsxUrl, pdfOk] = await Promise.all([
        uploadOutput(pptxPath, `${prefix}.pptx`),
        uploadOutput(xlsxPath, `${prefix}.xlsx`),
        pdfReadyPromise,
      ]);

      const pdfUrl = pdfOk
        ? await uploadOutput(pdfPath, `${prefix}.pdf`)
        : undefined;

      logger.info("BOD report generation complete", {
        pptx: !!pptxUrl, xlsx: !!xlsxUrl, pdf: !!pdfUrl,
      });

      return {
        outputs: {
          pptx: pptxUrl,
          xlsx: xlsxUrl,
          pdf: pdfUrl,
        },
      };
    }),
});
