/* Read an .xlsx / .xls / .csv file from disk into a uniform shape.
   Scratchpad-only; the Phase-1 production parser lives at
   core/lib/parse-ledger.ts once we promote the proven logic. */

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import * as XLSX from "xlsx";

export type Row = Record<string, string | number | null>;

export type Parsed = {
  columns: string[];
  rows: Row[];
  sheetName: string;
};

export function parseFile(filePath: string): Parsed {
  const ext = extname(filePath).toLowerCase();
  const buf = readFileSync(filePath);

  // SheetJS auto-detects xlsx/xls/csv from the buffer signature.
  const workbook = XLSX.read(buf, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`No sheets found in ${filePath}`);
  }
  const sheet = workbook.Sheets[sheetName];

  // sheet_to_json with { defval: null } so blank cells become null
  // instead of being omitted (otherwise different rows have different
  // shapes and matching gets fragile).
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    defval: null,
    raw: false,
  });

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return { columns, rows, sheetName: ext === ".csv" ? "CSV" : sheetName };
}
