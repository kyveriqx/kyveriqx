/* Integration test: real XLSX bytes → parse → reconcile.

   The unit tests in match.test.ts hand-build BankTxn/BooksTxn objects, so
   they never touch the header-probing or date/currency coercion in parse.ts.
   This test builds genuine .xlsx buffers (bank uses Indian "Withdrawal/Deposit"
   columns + DD/MM/YYYY dates; books uses "Debit/Credit") and runs the whole
   pipeline, the way the Trigger.dev job does. */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseBankStatement, parseBooksLedger, mergeTxns } from "./parse";
import { reconcile } from "./match";

function xlsxBuf(aoa: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parse → reconcile (real xlsx)", () => {
  const bankBuf = xlsxBuf([
    ["Txn Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
    ["01/04/2026", "NEFT FROM CUST X", "", 1000, 1000],
    ["10/04/2026", "UPI CR CONSOLIDATED", "", 7500, 8500],
    ["12/04/2026", "RAZORPAY SETTLEMENT AXISXXXX", "", 9764, 18264],
    ["13/04/2026", "SMS CHRG GST", 50, "", 18214],
  ]);

  const booksBuf = xlsxBuf([
    ["Date", "Particulars", "Debit", "Credit"],
    ["01/04/2026", "Sales - Cust X", 1000, ""],
    ["10/04/2026", "UPI/cust A", 1500, ""],
    ["10/04/2026", "UPI/cust B", 2500, ""],
    ["10/04/2026", "UPI/cust C", 3500, ""],
    ["12/04/2026", "Razorpay/inv 1", 8000, ""],
    ["12/04/2026", "Razorpay/inv 2", 2000, ""],
  ]);

  it("detects the bank columns from Indian-bank headers", async () => {
    const bank = await parseBankStatement(bankBuf);
    expect(bank.txns).toHaveLength(4);
    expect(bank.columns.credit).toBe("Deposit Amt.");
    expect(bank.columns.debit).toBe("Withdrawal Amt.");
    expect(bank.txns[1].signed).toBe(7500); // deposit → positive inflow
  });

  it("reconciles UPI grouping, Razorpay fee, and a bank charge end-to-end", async () => {
    const bank = await parseBankStatement(bankBuf);
    const books = await parseBooksLedger(booksBuf);
    const r = reconcile(bank.txns, books.txns);

    expect(r.summary.byMethod.exact).toBe(1);        // NEFT 1000 ↔ Sales 1000
    expect(r.summary.byMethod["group-exact"]).toBe(1); // UPI 6000 = 1000+2000+3000
    expect(r.summary.byMethod["group-fee"]).toBe(1);   // Razorpay 9764 ≈ 10000 − fee

    const fee = r.groups.find((g) => g.method === "group-fee")!;
    expect(fee.fee).toBe(236);
    expect(fee.feeRatePct).toBe(2.36);
    expect(r.summary.feesIdentified).toBe(236);

    // only the SMS charge is left over, classified as a bank charge
    expect(r.summary.unmatchedBankCount).toBe(1);
    expect(r.summary.unmatchedBooksCount).toBe(0);
    expect(r.unmatchedBank[0].hint).toBe("bank-charge");
    expect(r.summary.bankChargesTotal).toBe(50);

    // gap = unrecorded Razorpay fee (236) + bank charge not in books (50)
    expect(r.summary.netGap).toBe(-286);
  });
});

describe("mergeTxns — multi-file merge", () => {
  type Row = { row: number; file: string; fileRow: number; date: Date | null; amount: number };
  const mk = (fileRow: number, date: string | null, amount: number): Row => ({
    row: fileRow, file: "", fileRow, date: date ? new Date(`${date}T00:00:00Z`) : null, amount,
  });

  it("numbers rows globally in file order and records per-file ranges", () => {
    const { merged, sources, notes } = mergeTxns<Row>([
      { file: "jan.xlsx", txns: [mk(1, "2026-01-05", 100), mk(2, "2026-01-20", 200)] },
      { file: "feb.xlsx", txns: [mk(1, "2026-02-03", 300)] },
    ], (t) => t.date);

    expect(merged.map((m) => m.row)).toEqual([1, 2, 3]);
    expect(merged.map((m) => m.file)).toEqual(["jan.xlsx", "jan.xlsx", "feb.xlsx"]);
    expect(merged.map((m) => m.fileRow)).toEqual([1, 2, 1]);
    expect(sources).toEqual([
      { file: "jan.xlsx", rows: 2, rowStart: 1, rowEnd: 2 },
      { file: "feb.xlsx", rows: 1, rowStart: 3, rowEnd: 3 },
    ]);
    expect(notes).toHaveLength(0); // disjoint periods
  });

  it("warns (but does not drop) when two files' date ranges overlap", () => {
    const { merged, notes } = mergeTxns<Row>([
      { file: "jan.xlsx", txns: [mk(1, "2026-01-05", 100), mk(2, "2026-01-31", 200)] },
      { file: "overlap.xlsx", txns: [mk(1, "2026-01-28", 300)] },
    ], (t) => t.date);

    expect(merged).toHaveLength(3); // nothing dropped
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("overlap");
  });
});
