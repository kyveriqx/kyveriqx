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
  const s = String(v).trim().replace(/,/g, "").replace(/₹/g, "").replace(/Rs\.?/gi, "");
  if (s === "" || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
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
  // Header row = first row that contains "date" AND something with "document".
  let hdrRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const lowered = rows[i].map((c) => cleanStr(c).toLowerCase());
    if (lowered.includes("date") && lowered.some((v) => v.includes("document"))) {
      hdrRow = i;
      break;
    }
  }
  if (hdrRow === -1) return null;

  const hdr = rows[hdrRow].map((c) => cleanStr(c).toLowerCase());

  const findOr = (frag: string, fallback: number) => {
    const idx = findCol(hdr, frag);
    return idx === -1 ? fallback : idx;
  };

  const cDate     = findOr("date", 1);
  const cDocType  = findOr("document type", 2);
  const cDocNo    = findOr("document no", 4);
  const cExtDocNo = findOr("external document", 7);
  const cTds      = findOr("tds", 11);
  const cDebit    = findOr("debit", 12);
  const cCredit   = findOr("credit", 14);
  const cBalance  = findOr("balance", 15);

  let openingBal = 0;
  let closingBal = 0;
  let closingDrCr: DrCr = "Cr"; // default: company owes partner
  let partyName = "";
  const records: CompanyTxn[] = [];

  const cellAt = (r: Row, i: number): Cell => (i >= 0 && i < r.length ? r[i] : null);

  for (let r = hdrRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((v) => v === null || v === undefined || v === "")) continue;

    const label = cleanStr(cellAt(row, cDocNo));
    const labelLower = label.toLowerCase();

    if (labelLower.includes("opening balance")) {
      const rawBal = toFloat(cellAt(row, cBalance));
      const rawCr = toFloat(cellAt(row, cCredit));
      openingBal = rawBal !== 0 ? rawBal : rawCr;
      continue;
    }

    if (labelLower.includes("closing balance")) {
      const rawBal = toFloat(cellAt(row, cBalance));
      const rawCr = toFloat(cellAt(row, cCredit));
      closingBal = rawBal !== 0 ? rawBal : rawCr;
      // Scan from right for Dr./Cr.
      for (let i = row.length - 1; i >= 0; i--) {
        const s = cleanStr(row[i]).toLowerCase();
        if (s === "dr." || s === "dr" || s === "debit") {
          closingDrCr = "Dr";
          break;
        }
        if (s === "cr." || s === "cr" || s === "credit") {
          closingDrCr = "Cr";
          break;
        }
      }
      continue;
    }

    // Party name = first non-empty col-0 after header, excluding "balance" rows.
    if (!partyName) {
      const c0 = cleanStr(cellAt(row, 0));
      if (c0 && !c0.toLowerCase().includes("balance")) {
        partyName = c0;
      }
    }

    const dateVal = parseDate(cellAt(row, cDate));
    const docType = cleanStr(cellAt(row, cDocType));
    const docNo   = cleanStr(cellAt(row, cDocNo));
    const extNo   = cleanInvoiceNo(cellAt(row, cExtDocNo));
    const tds     = toFloat(cellAt(row, cTds));
    const debit   = toFloat(cellAt(row, cDebit));
    const credit  = toFloat(cellAt(row, cCredit));
    const balance = toFloat(cellAt(row, cBalance));

    if (dateVal === null && docType === "" && credit === 0 && debit === 0) continue;
    if (docType.toLowerCase().includes("summary")) continue;
    if (docNo.toLowerCase().includes("balance as on")) continue;

    records.push({
      sheet: sheetName,
      date: dateVal,
      docType,
      docNo,
      extNo,
      tds,
      debit,
      credit,
      balance,
      opening: openingBal,
      closing: closingBal,
    });
  }

  if (records.length === 0) return null;

  return {
    sheet: sheetName,
    partyName,
    openingBal,
    closingBal,
    closingDrCr,
    records,
  };
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
