/* CLI: load two sample ledgers, run the matcher, print results.
   Usage:
     npx tsx scratch/orgledgerreco/run.ts
     npx tsx scratch/orgledgerreco/run.ts --key="Voucher No"
     npx tsx scratch/orgledgerreco/run.ts --key=VchNo --amount-col=Amount --date-col=Date
     npx tsx scratch/orgledgerreco/run.ts --a=path/to/a.xlsx --b=path/to/b.xlsx --key=...

   Defaults:
     --a   scratch/orgledgerreco/sample-data/company-a.xlsx
     --b   scratch/orgledgerreco/sample-data/company-b.xlsx
     --key (auto-detected: first column appearing in both files) */

import { resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { parseFile } from "./parse";
import { matchLedgers, type MatcherConfig } from "./matcher";

type Args = {
  a?: string;
  b?: string;
  key?: string;
  amountCol?: string;
  dateCol?: string;
  amountTolerance?: number;
};

function parseArgs(): Args {
  const args: Args = {};
  for (const raw of process.argv.slice(2)) {
    const m = raw.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, key, value] = m;
    const v = value ?? "true";
    switch (key) {
      case "a": args.a = v; break;
      case "b": args.b = v; break;
      case "key": args.key = v; break;
      case "amount-col": args.amountCol = v; break;
      case "date-col": args.dateCol = v; break;
      case "amount-tolerance": args.amountTolerance = Number(v); break;
    }
  }
  return args;
}

function findDefaultSampleFile(prefix: string): string | null {
  const dir = resolve(process.cwd(), "scratch/orgledgerreco/sample-data");
  if (!existsSync(dir)) return null;
  const exts = [".xlsx", ".xls", ".csv"];
  const files = readdirSync(dir);
  const exact = files.find((f) => exts.some((e) => f.toLowerCase() === `${prefix}${e}`));
  if (exact) return resolve(dir, exact);
  const prefixed = files.find((f) => f.toLowerCase().startsWith(prefix) && exts.some((e) => f.toLowerCase().endsWith(e)));
  return prefixed ? resolve(dir, prefixed) : null;
}

function bail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function fmtPct(n: number, total: number): string {
  if (total === 0) return "—";
  return `${((n / total) * 100).toFixed(1)}%`;
}

const args = parseArgs();

const aPath = args.a
  ? resolve(args.a)
  : findDefaultSampleFile("company-a") ?? findDefaultSampleFile("a");
const bPath = args.b
  ? resolve(args.b)
  : findDefaultSampleFile("company-b") ?? findDefaultSampleFile("b");

if (!aPath) bail("No File A found. Drop a file named 'company-a.xlsx' (or company-a.csv) into scratch/orgledgerreco/sample-data/, or pass --a=<path>.");
if (!bPath) bail("No File B found. Drop a file named 'company-b.xlsx' (or company-b.csv) into scratch/orgledgerreco/sample-data/, or pass --b=<path>.");

console.log(`\nFile A: ${aPath}`);
console.log(`File B: ${bPath}\n`);

const a = parseFile(aPath);
const b = parseFile(bPath);

console.log(`File A — sheet "${a.sheetName}", ${a.rows.length} rows, columns: ${a.columns.map((c) => `"${c}"`).join(", ")}`);
console.log(`File B — sheet "${b.sheetName}", ${b.rows.length} rows, columns: ${b.columns.map((c) => `"${c}"`).join(", ")}\n`);

// Pick match key.
let keyColumn = args.key;
if (!keyColumn) {
  const common = a.columns.filter((c) => b.columns.includes(c));
  if (common.length === 0) {
    bail(`No columns in common between A and B. Pass --key=<column> explicitly, or check that header rows match.`);
  }
  keyColumn = common[0];
  console.log(`Auto-picked key column: "${keyColumn}" (first column common to both files)`);
  if (common.length > 1) {
    console.log(`  Other common columns: ${common.slice(1).map((c) => `"${c}"`).join(", ")}`);
  }
  console.log(`  To override: --key="<column name>"\n`);
}

const config: MatcherConfig = {
  keyColumn,
  amountColumn: args.amountCol,
  dateColumn: args.dateCol,
  amountTolerance: args.amountTolerance,
};

const result = matchLedgers(a.rows, b.rows, config);

const total = a.rows.length + b.rows.length;
const matched = result.matched.length;
const mismatched = result.mismatched.length;
const onlyA = result.onlyInA.length;
const onlyB = result.onlyInB.length;

console.log("─".repeat(60));
console.log("RESULTS");
console.log("─".repeat(60));
console.log(`A rows:        ${result.stats.aRowCount}`);
console.log(`B rows:        ${result.stats.bRowCount}`);
console.log(`A missing key: ${result.stats.aRowsMissingKey}`);
console.log(`B missing key: ${result.stats.bRowsMissingKey}`);
console.log();
console.log(`✓ Matched (agreeing):   ${matched.toString().padStart(6)} (${fmtPct(matched * 2, total)} of all rows)`);
console.log(`⚠ Mismatched (key OK):  ${mismatched.toString().padStart(6)} (${fmtPct(mismatched * 2, total)} of all rows)`);
console.log(`→ Only in A:            ${onlyA.toString().padStart(6)}`);
console.log(`← Only in B:            ${onlyB.toString().padStart(6)}`);
console.log();

function showSample(label: string, rows: { a?: unknown; b?: unknown; reasons?: string[] }[] | unknown[]) {
  if (rows.length === 0) return;
  console.log(`── First ${Math.min(5, rows.length)} ${label} ──`);
  for (const r of rows.slice(0, 5)) console.log(JSON.stringify(r, null, 2));
  console.log();
}

showSample("matched (sample)", result.matched);
showSample("mismatched", result.mismatched);
showSample("only-in-A", result.onlyInA);
showSample("only-in-B", result.onlyInB);
