/* Integration test: real XLSX bytes → parse → reconcile.

   The unit tests in match.test.ts hand-build BankTxn/BooksTxn objects, so
   they never touch the header-probing or date/currency coercion in parse.ts.
   This test builds genuine .xlsx buffers (bank uses Indian "Withdrawal/Deposit"
   columns + DD/MM/YYYY dates; books uses "Debit/Credit") and runs the whole
   pipeline, the way the Trigger.dev job does. */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseBankStatement, parseBooksLedger } from "./parse";
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

  it("detects the bank columns from Indian-bank headers", () => {
    const bank = parseBankStatement(bankBuf);
    expect(bank.txns).toHaveLength(4);
    expect(bank.columns.credit).toBe("Deposit Amt.");
    expect(bank.columns.debit).toBe("Withdrawal Amt.");
    expect(bank.txns[1].signed).toBe(7500); // deposit → positive inflow
  });

  it("reconciles UPI grouping, Razorpay fee, and a bank charge end-to-end", () => {
    const bank = parseBankStatement(bankBuf);
    const books = parseBooksLedger(booksBuf);
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
