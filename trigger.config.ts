/* Trigger.dev config — Architecture §8.5.
   Tasks live next to their tool at /tools/<slug>/jobs/<name>.ts.
   That folder layout is the "add a tool a day" rule from the doc. */

import { defineConfig } from "@trigger.dev/sdk";

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
    extensions: [],
  },

  // Reconciliation runs can chew through large files; give them headroom.
  maxDuration: 3600,
});
