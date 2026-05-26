/* Trigger.dev config — Architecture §8.5.
   Tasks live next to their tool at /tools/<slug>/jobs/<name>.ts.
   That folder layout is the "add a tool a day" rule from the doc. */

import { defineConfig } from "@trigger.dev/sdk";
import { pythonExtension } from "@trigger.dev/python/extension";

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
        requirementsFile: "./tools/orgmis/python/requirements.txt",
        devPythonBinaryPath: "python",
      }),
    ],
  },

  // Reconciliation + report generation can chew through large files;
  // give them headroom (BOD MIS deck generation = ~30-60s typical).
  maxDuration: 3600,
});
