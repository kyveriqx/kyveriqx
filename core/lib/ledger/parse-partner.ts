/* Parse Your Business Partner's ledger (multi-sheet, one location per sheet,
   typically Posting Date / Document Type / Document No / ... / Amount / Balance).

   Direct port of parse_partner_ledger() in parse_ledger.py. */

import * as XLSX from "xlsx";
import type { PartnerLedger, PartnerLocation, PartnerTxn } from "./types";

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
    const d = XLSX.SSF?.parse_date_code?.(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (m) {
    const day = Number(m[1]), mon = Number(m[2]), yr = Number(m[3]);
    const year = yr < 100 ? 2000 + yr : yr;
    return new Date(Date.UTC(year, mon - 1, day));
  }
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

function findCol(hdr: string[], frag: string): number {
  const f = frag.toLowerCase();
  return hdr.findIndex((h) => h.includes(f));
}

function parseLocation(sheetName: string, rows: Row[]): PartnerLocation | null {
  // Header row: "posting date" preferred, else any row with both "date" and "amount".
  let hdrRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const lowered = rows[i].map((c) => cleanStr(c).toLowerCase());
    if (lowered.includes("posting date")) {
      hdrRow = i;
      break;
    }
    if (lowered.includes("date") && lowered.includes("amount")) {
      hdrRow = i;
      break;
    }
  }
  if (hdrRow === -1) {
    // Fallback: case-insensitive substring match for "Date" + "Amount" anywhere.
    for (let i = 0; i < rows.length; i++) {
      const vs = rows[i].map((c) => cleanStr(c));
      if (vs.some((v) => v.includes("Date")) && vs.some((v) => v.includes("Amount"))) {
        hdrRow = i;
        break;
      }
    }
  }
  if (hdrRow === -1) return null;

  const hdr = rows[hdrRow].map((c) => cleanStr(c).toLowerCase());

  const findOr = (frag: string, fallback: number) => {
    const idx = findCol(hdr, frag);
    return idx === -1 ? fallback : idx;
  };

  const cDate  = findOr("posting date", findCol(hdr, "date") === -1 ? 0 : findCol(hdr, "date"));
  const cType  = findOr("document type", 1);
  const cDocNo = findOr("document no", 2);
  const cAmt   = findOr("amount", 7);
  const cBal   = findOr("balance", 9);

  // Opening balance: look for "before period" row or a C-code line with a numeric col 9.
  let openingBal = 0;
  let partyName = "";

  for (let i = 0; i < hdrRow; i++) {
    const vs = rows[i].map((c) => cleanStr(c)).filter(Boolean);
    for (const v of vs) {
      if (!partyName && v.length > 5 && !/^C\d{4,}/.test(v) &&
          !/(gst|pan|ph|fax|survey|india)/i.test(v)) {
        partyName = v;
      }
    }
  }

  for (const row of rows) {
    const vs = row.map((c) => cleanStr(c));
    if (vs.some((v) => v.toLowerCase().includes("before period"))) {
      for (const v of row) {
        const f = toFloat(v);
        if (f !== 0) openingBal = f;
      }
      break;
    }
    // Fallback: C-code line with balance in col 9.
    if (row.some((c) => /^C\d{4,}/.test(cleanStr(c)))) {
      const v9 = row[9];
      if (typeof v9 === "number") openingBal = v9;
    }
  }

  let closingBal = 0;
  const records: PartnerTxn[] = [];
  const cellAt = (r: Row, i: number): Cell => (i >= 0 && i < r.length ? r[i] : null);

  for (let r = hdrRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((v) => v === null || v === undefined || v === "")) continue;

    const first = cleanStr(cellAt(row, 0));
    const firstLower = first.toLowerCase();
    if (firstLower.includes("total (lcy)") && !firstLower.includes("before")) {
      const balV = cellAt(row, 8);
      if (balV !== null && balV !== undefined) {
        const n = toFloat(balV);
        if (n !== 0) closingBal = n;
      }
      continue;
    }

    const dateVal = parseDate(cellAt(row, cDate));
    const docType = cleanStr(cellAt(row, cType));
    const docNoRaw = cleanStr(cellAt(row, cDocNo));
    const docNo = cleanInvoiceNo(docNoRaw);
    const amtVal = toFloat(cellAt(row, cAmt));
    const balVal = toFloat(cellAt(row, cBal));

    if (dateVal === null && amtVal === 0) continue;
    if (docType.trim() === "" && amtVal === 0) continue;

    records.push({
      location: sheetName,
      date: dateVal,
      docType,
      docNo,
      amount: amtVal,
      balance: balVal,
    });
  }

  return {
    location: sheetName,
    partyName,
    openingBal,
    closingBal,
    transactions: records,
  };
}

export function parsePartnerLedger(buffer: ArrayBuffer | Uint8Array | Buffer): PartnerLedger {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });

  const locations: PartnerLocation[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: null, raw: false });
    const loc = parseLocation(name, rows);
    if (loc) locations.push(loc);
  }

  if (locations.length === 0) {
    throw new Error(
      "Could not read Your Business Partner's Ledger — please check the file format. " +
      "The file must contain a header row with 'Posting Date' (or 'Date') and 'Amount'.",
    );
  }

  const totalClosing = locations.reduce((sum, l) => sum + l.closingBal, 0);

  return { locations, totalClosing };
}
