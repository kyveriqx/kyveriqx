/* Trigger.dev config — Architecture §8.5.
   Tasks live next to their tool at /tools/<slug>/jobs/<name>.ts.
   That folder layout is the "add a tool a day" rule from the doc. */

import { defineConfig } from "@trigger.dev/sdk";
import { pythonExtension } from "@trigger.dev/python/extension";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { readFileSync } from "node:fs";

/** Read `.env.local` at deploy time and return the keys our tasks actually
 *  need on the worker. Vercel and Trigger.dev have separate env namespaces;
 *  without this the orgmis-generate-report task fails immediately with
 *  "supabaseUrl is required" because it tries to createClient() with
 *  undefined env vars. Same .env.local parser used by scripts/. */
const WORKER_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function readDotEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => {
          const eq = l.indexOf("=");
          if (eq === -1) return null;
          const k = l.slice(0, eq).trim();
          let v = l.slice(eq + 1).trim();
          if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
          ) {
            v = v.slice(1, -1);
          }
          return [k, v] as const;
        })
        .filter((e): e is readonly [string, string] => e !== null),
    );
  } catch {
    return {};
  }
}

export default defineConfig({
  project: "proj_tqwxkaebnfuzapnsaqlq",

  // Recursively scan all tool job folders.
  dirs: ["./tools"],

  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },

  build: {
    extensions: [
      // OrgMIS (BOD MIS Generator) — the report pipeline runs as Python
      // (openpyxl + python-pptx). The extension installs Python + the deps
      // into the Trigger.dev worker image so the JS task can shell to them.
      pythonExtension({
        // Inline list instead of requirementsFile — the latter has a path
        // bug in @trigger.dev/python 4.4.6: it COPYs the file to WORKDIR
        // but then `pip install -r` uses the original (now-missing) path.
        // Keep requirements.txt around for local dev / IDE hints.
        requirements: ["openpyxl==3.1.5", "python-pptx==1.0.2"],
        // Without `scripts`, none of our .py files end up in the deployed
        // worker image — python.runScript() fails with "Script does not
        // exist: /app/tools/orgmis/python/pipeline.py". Glob in everything
        // under the python folder so config_loader + the 5 stage scripts
        // (analyze, build_mis_excel, build_bod_deck, convert_pdf, pipeline)
        // all ship.
        scripts: ["./tools/orgmis/python/*.py"],
        devPythonBinaryPath: "python",
      }),
      syncEnvVars(async () => {
        const env = readDotEnvLocal();
        const out: Record<string, string> = {};
        for (const key of WORKER_ENV_KEYS) {
          if (env[key]) out[key] = env[key];
        }
        return out;
      }),
    ],
  },

  // Reconciliation + report generation can chew through large files;
  // give them headroom (BOD MIS deck generation = ~30-60s typical).
  maxDuration: 3600,
});
