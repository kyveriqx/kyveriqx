/* Parse Your Company's ledger (the user's own books — typically a Tally/BC
   export with Date / Document Type / Document No / External Document /
   TDS / Debit / Credit / Balance columns).

   Direct port of parse_company_ledger() in the reference Python file
   (parse_ledger.py). Reads .xlsx / .xls / .csv via SheetJS in header:1 mode
   so we can locate the header row by content rather than trusting position. */

import * as XLSX from "xlsx";
import type { CompanyLedger, CompanyTxn, DrCr } from "./types";

type Cell = string | number | boolean | Date | null | undefined;
type Row = Cell[];

function cleanStr(v: Cell): string {
  if (v === null || v === undefined) return "";
  return String(v).trim().replace(/\n/g, " ");
}

function toFloat(v: Cell): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return 0;
  let s = String(v).trim().replace(/,/g, "").replace(/[₹$]/g, "").replace(/Rs\.?/gi, "").trim();
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (s === "" || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : 0;
}

/** Dr/Cr label scanned from the right of a marker row (e.g. " Cr." / "Dr"). */
function drcrLabel(row: Cell[]): DrCr | "" {
  for (let i = row.length - 1; i >= 0; i--) {
    const s = cleanStr(row[i]).replace(/\.$/, "").toLowerCase();
    if (s === "cr" || s === "credit") return "Cr";
    if (s === "dr" || s === "debit") return "Dr";
  }
  return "";
}

/** Value of the rightmost numeric cell in a row — opening/closing markers put
 *  the balance in a shifted column, so a fixed index can't be trusted. */
function rightmostNum(row: Cell[]): number {
  let v = 0;
  for (const c of row) {
    if (c === null || c === undefined || c === "") continue;
    if (typeof c === "number") { v = c; continue; }
    const s = String(c).replace(/[,$₹]/g, "").replace(/Rs\.?/gi, "").replace(/[()]/g, "").trim();
    if (s !== "" && s !== "-" && Number.isFinite(Number(s))) v = toFloat(c);
  }
  return v;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(v: Cell): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // Excel serial date — SheetJS handles via cellDates:true, but if a number
    // slips through, convert via SSF.
    const d = XLSX.SSF?.parse_date_code?.(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;

  // dd/mm/yyyy or dd-mm-yyyy (also yy)
  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (m) {
    const day = Number(m[1]), mon = Number(m[2]), yr = Number(m[3]);
    const year = yr < 100 ? 2000 + yr : yr;
    return new Date(Date.UTC(year, mon - 1, day));
  }

  // dd-MMM-yy or dd-MMM-yyyy
  m = s.match(/^(\d{1,2})[\/-]([A-Za-z]{3})[\/-](\d{2}|\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon === undefined) return null;
    const yr = Number(m[3]);
    const year = yr < 100 ? 2000 + yr : yr;
    return new Date(Date.UTC(year, mon, day));
  }

  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function cleanInvoiceNo(raw: Cell): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).split("\n")[0].trim();
  return s.split(" /")[0].trim().toUpperCase();
}

/** Find the column index of the first header cell whose lowercased text
 *  contains `frag`. Returns -1 if not present. */
function findCol(hdr: string[], frag: string): number {
  const f = frag.toLowerCase();
  return hdr.findIndex((h) => h.includes(f));
}

type SheetParsed = {
  sheet: string;
  partyName: string;
  openingBal: number;
  closingBal: number;
  closingDrCr: DrCr;
  records: CompanyTxn[];
};

function parseSheet(sheetName: string, rows: Row[]): SheetParsed | null {
  // Header row = first row that has Date + both Debit Amount and Credit Amount
  // columns (each DCS sheet uses a different column layout, so detect by name).
  let hdrRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const lowered = rows[i].map((c) => cleanStr(c).toLowerCase());
    if (lowered.some((v) => v === "date") &&
        lowered.some((v) => v.includes("debit")) &&
        lowered.some((v) => v.includes("credit"))) {
      hdrRow = i;
      break;
    }
  }
  if (hdrRow === -1) return null;

  const hdr = rows[hdrRow].map((c) => cleanStr(c).toLowerCase());
  const find = (pred: (h: string) => boolean, fallback: number) => {
    const idx = hdr.findIndex(pred);
    return idx === -1 ? fallback : idx;
  };
  const cDate     = find((h) => h === "date", 1);
  const cDocType  = find((h) => h.includes("document type"), 2);
  const cDocNo    = find((h) => h.includes("document no"), 4); // before "external document no."
  const cExtDocNo = find((h) => h.includes("external document"), 7);
  const cTds      = find((h) => h.includes("tds"), 11);
  const cDebit    = find((h) => h.includes("debit"), 12);
  const cCredit   = find((h) => h.includes("credit"), 14);
  const cBalance  = find((h) => h.includes("balance"), 15);

  let openingBal = 0;
  let closingBal = 0;
  let closingDrCr: DrCr = "Cr"; // default: company owes partner
  let partyName = "";
  const records: CompanyTxn[] = [];

  const cellAt = (r: Row, i: number): Cell => (i >= 0 && i < r.length ? r[i] : null);

  for (let r = hdrRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((v) => v === null || v === undefined || v === "")) continue;

    // Markers can sit in a shifted column, so scan the whole row's text.
    const rowText = row.filter((c) => typeof c === "string").join(" ").toLowerCase();

    if (rowText.includes("opening balance")) {
      const bal = rightmostNum(row);
      openingBal = drcrLabel(row) === "Dr" ? -bal : bal;
      continue;
    }
    if (rowText.includes("closing balance")) {
      closingBal = rightmostNum(row);
      const lbl = drcrLabel(row);
      if (lbl) closingDrCr = lbl;
      break; // the Summary block (grand-total rows) follows — stop here
    }

    if (!partyName) {
      const c0 = cleanStr(cellAt(row, 0));
      // Account header looks like "VEN-00137  :  CENTENARY GEOTEX PVT.LTD".
      const acct = c0.match(/^(?:VEN-|VU)\S*\s*:\s*(.+)$/i);
      if (acct) {
        partyName = acct[1].trim();
      } else if (c0 && !c0.toLowerCase().includes("balance") &&
                 parseDate(c0) === null && !/^\d/.test(c0)) {
        partyName = c0;
      }
    }

    const debit  = toFloat(cellAt(row, cDebit));
    const credit = toFloat(cellAt(row, cCredit));
    if (debit === 0 && credit === 0) continue; // skip non-movement rows

    records.push({
      sheet: sheetName,
      date: parseDate(cellAt(row, cDate)),
      docType: cleanStr(cellAt(row, cDocType)),
      docNo: cleanStr(cellAt(row, cDocNo)),
      extNo: cleanInvoiceNo(cellAt(row, cExtDocNo)),
      tds: toFloat(cellAt(row, cTds)),
      debit,
      credit,
      balance: toFloat(cellAt(row, cBalance)),
      opening: openingBal,
      closing: closingBal,
    });
  }

  if (records.length === 0) return null;

  return { sheet: sheetName, partyName, openingBal, closingBal, closingDrCr, records };
}

export function parseCompanyLedger(buffer: ArrayBuffer | Uint8Array | Buffer): CompanyLedger {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });

  const sheets: SheetParsed[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: null, raw: false });
    const parsed = parseSheet(name, rows);
    if (parsed) sheets.push(parsed);
  }

  if (sheets.length === 0) {
    throw new Error(
      "Could not read Your Company's Ledger — please check the file format. " +
      "The file must contain a header row with 'Date' and 'Document No'.",
    );
  }

  // Combine all transactions, take closing from the last sheet, opening from the first.
  const transactions = sheets.flatMap((s) => s.records);
  const last = sheets[sheets.length - 1];

  // Sign convention: Dr balance in the partner's account = company overpaid (negative payable).
  const rawClose = last.closingBal;
  const closingBal = last.closingDrCr === "Dr" ? -Math.abs(rawClose) : Math.abs(rawClose);

  let minDate: Date | null = null;
  for (const t of transactions) {
    if (t.date && (!minDate || t.date < minDate)) minDate = t.date;
  }

  return {
    partyName: last.partyName,
    openingBal: sheets[0].openingBal,
    closingBal,
    closingRaw: rawClose,
    closingDrCr: last.closingDrCr,
    transactions,
    minDate,
  };
}
