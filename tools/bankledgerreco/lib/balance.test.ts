import { describe, it, expect } from "vitest";
import { checkRunningBalance } from "./parse";

/** A minimal row for the tie-out check: signed amount + printed balance. */
function row(signed: number, balance: number | null, fileRow: number) {
  return { signed, balance, fileRow };
}

describe("checkRunningBalance — running-balance tie-out", () => {
  it("ties out: bank balance moves with signed → no warning", () => {
    // opening 1000; balance follows credit − debit each row.
    const txns = [
      row(+500, 1500, 1),
      row(-200, 1300, 2),
      row(+1000, 2300, 3),
      row(-300, 2000, 4),
    ];
    expect(checkRunningBalance(txns, "bank.pdf")).toBeNull();
  });

  it("flags a dropped row: residual equals the missing amount", () => {
    // The +1000 row (printed balance 2300) was lost during parsing — the next
    // row's printed balance (2000) no longer follows from the rows we kept.
    const txns = [
      row(+500, 1500, 1),
      row(-200, 1300, 2),
      row(-300, 2000, 3), // jumps by +700 but signed is only −300
    ];
    const note = checkRunningBalance(txns, "bank.pdf");
    expect(note).not.toBeNull();
    expect(note).toContain("bank.pdf");
    expect(note).toContain("off by ₹1,000.00");
    expect(note).toContain("row 3"); // first mismatch
  });

  it("skips silently when there is no balance column", () => {
    const txns = [
      row(+500, null, 1),
      row(-200, null, 2),
      row(+1000, null, 3),
    ];
    expect(checkRunningBalance(txns, "statement.csv")).toBeNull();
  });

  it("auto-detects an inverted (books-side) balance convention", () => {
    // Books bank-ledger: balance moves AGAINST signed (debit − credit). A clean
    // file must still tie out without a warning.
    const txns = [
      row(+500, 500, 1), // opening 1000 → 1000 − 500
      row(-200, 700, 2),
      row(+300, 400, 3),
    ];
    expect(checkRunningBalance(txns, "books.xlsx")).toBeNull();
  });
});
