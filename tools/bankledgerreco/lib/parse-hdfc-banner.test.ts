/* Regression: HDFC-style .xls statements that broke a live customer job.

   Two real-world traps, both reproduced here against synthesised xlsx bytes:
     1. a ~20-row title banner (account holder / address / statement period /
        asterisk rule) pushes the real transaction header far below row 5, where
        the old 5-row header scan never looked → 0 rows parsed → whole job failed;
     2. a trailing "STATEMENT SUMMARY" block (Opening/Closing balance, total
        Debits/Credits, Dr/Cr counts) whose figures otherwise parse as enormous
        fake transactions — the opening-balance number lands in the date column
        and used to coerce to an absurd year, surviving the date filter.

   The fix: probeHeaders scans a wide window, toDate rejects out-of-range serials
   / bare numbers, and a detected date column makes a date mandatory. */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseBankStatement, toDate, checkRunningBalance } from "./parse";

function xlsxBuf(aoa: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// 19 rows of banner, then header (row 19), asterisk rule, 3 real txns, then the
// summary trailer. Opening balance 1000 → 800 → 1300 → 1200 closing.
const HDFC = xlsxBuf([
  ["HDFC BANK Ltd.   Page No.: 1   Statement of accounts", "", "", "", "", "", ""],
  ["", "", "", "", "", "", ""],
  ["", "", "", "", "Account Branch :SURAT", "", ""],
  ["M/S. EXAMPLE PRIVATE LIMITED", "", "", "", "Address :SOME ROAD", "", ""],
  ["OFFICE 1", "", "", "", "City :SURAT", "", ""],
  ["STREET 2", "", "", "", "State :GUJARAT", "", ""],
  ["SURAT 395007", "", "", "", "Phone no. :1800", "", ""],
  ["", "", "", "", "Email :", "", ""],
  ["JOINT HOLDERS :", "", "", "", "OD Limit :100   Currency :INR", "", ""],
  ["Nomination : Not Registered", "", "", "", "Cust ID :154035712", "", ""],
  ["Statement From : 01/04/2026 To : 03/04/2026", "", "", "", "Account No :502000", "", ""],
  ["", "", "", "", "Account Status :Regular", "", ""],
  ["", "", "", "", "RTGS/NEFT IFSC :HDFC0000067", "", ""],
  ["", "", "", "", "", "", ""],
  ["", "", "", "", "", "", ""],
  ["", "", "", "", "", "", ""],
  ["", "", "", "", "", "", ""],
  ["", "", "", "", "", "", ""],
  ["*****************************************", "", "", "", "", "", ""],
  ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
  ["********", "********", "********", "********", "********", "********", "********"],
  ["01/04/26", "CC AUTOPAY SI-TAD", "0000654760663", "01/04/26", 200, "", 800],
  ["02/04/26", "UPI-SOMEONE-PAYMENT", "0000674181420920", "02/04/26", "", 500, 1300],
  ["03/04/26", "NEFT CR-SOMEBANK", "0000545761351608", "03/04/26", 100, "", 1200],
  ["", "", "", "", "", "", ""],
  ["*****************************************", "", "", "", "", "", ""],
  ["STATEMENT SUMMARY  :-", "", "", "", "", "", ""],
  ["Opening Balance", "", "", "", "Debits", "Credits", "Closing Bal"],
  // Opening-balance number sits in the date column, and the period totals sit
  // in the amount columns — the exact trap. Sentinel figures no real txn shares.
  [-5990621.22, "", "", "", 842200053.64, 827172575.04, 1200],
  ["", "", "", "", "Dr Count", "Cr Count", ""],
  ["", "", "", "", 2, 1, ""],
  ["--- End Of Statement ---", "", "", "", "", "", ""],
]);

describe("HDFC-style banner + summary trailer", () => {
  it("finds the header below a tall banner and detects the columns", async () => {
    const { txns, columns } = await parseBankStatement(HDFC);
    expect(columns.date).toBe("Date");
    expect(columns.debit).toBe("Withdrawal Amt.");
    expect(columns.credit).toBe("Deposit Amt.");
    expect(columns.balance).toBe("Closing Balance");
    // Exactly the 3 real transactions — none of the 5 banner/summary rows.
    expect(txns).toHaveLength(3);
  });

  it("excludes the summary trailer so the running balance ties out", async () => {
    const { txns } = await parseBankStatement(HDFC);
    // The fake summary "transaction" (the period totals) would have blown this up.
    expect(txns.some((t) => t.debit === 842200053.64 || t.credit === 827172575.04)).toBe(false);
    expect(txns[txns.length - 1].balance).toBe(1200);
    expect(checkRunningBalance(txns, "hdfc.xls")).toBeNull(); // ties out → no warning
  });

  it("toDate rejects stray numerics that aren't real dates", () => {
    expect(toDate(-5990621.22)).toBeNull(); // out-of-range Excel serial
    expect(toDate(842200053.64)).toBeNull();
    expect(toDate("-5990621.22")).toBeNull(); // bare numeric string
    // …but still accepts the formats banks actually use.
    expect(toDate("01/04/26")).not.toBeNull();
    expect(toDate("2026-04-01")).not.toBeNull();
    expect(toDate(45748)).not.toBeNull(); // a valid in-range Excel serial
  });
});
