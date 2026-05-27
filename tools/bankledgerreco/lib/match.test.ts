import { describe, it, expect } from "vitest";
import { reconcile } from "./match";
import { DEFAULT_OPTIONS } from "./types";
import type { BankTxn, BooksTxn, SettlementRow } from "./types";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

function bank(row: number, date: string | null, desc: string, debit: number, credit: number): BankTxn {
  return { row, date: date ? d(date) : null, description: desc, debit, credit, signed: credit - debit, balance: null };
}
function book(row: number, date: string | null, desc: string, debit: number, credit: number): BooksTxn {
  return { row, date: date ? d(date) : null, description: desc, debit, credit, signed: debit - credit, balance: null };
}

describe("reconcile — tiered matching", () => {
  it("pass 1: exact same-date amount match", () => {
    const r = reconcile([bank(1, "2026-04-01", "NEFT IN", 0, 1000)], [book(1, "2026-04-01", "Sales", 1000, 0)]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("exact");
    expect(r.summary.unmatchedBankCount).toBe(0);
    expect(r.summary.unmatchedBooksCount).toBe(0);
  });

  it("pass 2: date-tolerant 1:1 within the window", () => {
    const r = reconcile([bank(1, "2026-04-05", "CHQ CLG", 0, 5000)], [book(1, "2026-04-03", "Cheque dep", 5000, 0)]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("date-tolerant");
    expect(r.groups[0].dateGapDays).toBe(2);
  });

  it("pass 4a: UPI day-aggregation — many books → one bank line", () => {
    const r = reconcile(
      [bank(1, "2026-04-10", "UPI CR CONSOLIDATED", 0, 6000)],
      [
        book(1, "2026-04-10", "UPI/cust A", 1000, 0),
        book(2, "2026-04-10", "UPI/cust B", 2000, 0),
        book(3, "2026-04-10", "UPI/cust C", 3000, 0),
      ],
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("group-exact");
    expect(r.groups[0].booksRows).toHaveLength(3);
    expect(r.groups[0].fee).toBe(0);
    expect(r.summary.unmatchedBooksCount).toBe(0);
  });

  it("pass 5: Razorpay settlement with inferred fee (no report)", () => {
    const r = reconcile(
      [bank(1, "2026-04-12", "RAZORPAY SETTLEMENT", 0, 9764)],
      [
        book(1, "2026-04-12", "Razorpay/inv 1", 6000, 0),
        book(2, "2026-04-12", "Razorpay/inv 2", 4000, 0),
      ],
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("group-fee");
    expect(r.groups[0].fee).toBe(236);
    expect(r.groups[0].feeRatePct).toBe(2.36);
    expect(r.summary.feesIdentified).toBe(236);
  });

  it("pass 0: Razorpay settlement report — exact fee + UTR", () => {
    const settlement: SettlementRow[] = [
      { row: 1, utr: "UTR123", settledAt: d("2026-04-15"), amount: 9764, fee: 200, tax: 36 },
    ];
    const r = reconcile(
      [bank(1, "2026-04-15", "RAZORPAY", 0, 9764)],
      [
        book(1, "2026-04-14", "Razorpay/inv 1", 6000, 0),
        book(2, "2026-04-14", "Razorpay/inv 2", 4000, 0),
      ],
      DEFAULT_OPTIONS,
      settlement,
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("settlement");
    expect(r.groups[0].fee).toBe(236);
    expect(r.groups[0].note).toContain("UTR123");
    expect(r.summary.unmatchedBooksCount).toBe(0);
  });

  it("pass 3: reversal pair on the bank side nets out", () => {
    const r = reconcile(
      [bank(1, "2026-04-20", "NEFT IN", 0, 2500), bank(2, "2026-04-21", "NEFT REVERSAL", 2500, 0)],
      [],
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("reversal");
    expect(r.groups[0].bankRows).toHaveLength(2);
    expect(r.summary.unmatchedBankCount).toBe(0);
  });

  it("pass 6: classifies bank charges, interest and TDS", () => {
    const r = reconcile(
      [
        bank(1, "2026-04-22", "SMS CHRG", 50, 0),
        bank(2, "2026-04-23", "SAVINGS INTEREST", 0, 300),
        bank(3, "2026-04-24", "TDS DEDUCTED", 30, 0),
      ],
      [],
    );
    expect(r.summary.bankChargesTotal).toBe(50);
    expect(r.summary.interestTotal).toBe(300);
    expect(r.summary.tdsTotal).toBe(30);
    const hints = r.unmatchedBank.map((u) => u.hint).sort();
    expect(hints).toEqual(["bank-charge", "interest", "tds"]);
  });

  it("pass 4b: one invoice paid via several bank receipts", () => {
    const r = reconcile(
      [bank(1, "2026-04-25", "PART 1", 0, 4000), bank(2, "2026-04-25", "PART 2", 0, 6000)],
      [book(1, "2026-04-25", "Invoice 9000", 10000, 0)],
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("group-exact");
    expect(r.groups[0].bankRows).toHaveLength(2);
    expect(r.groups[0].booksRows).toHaveLength(1);
  });

  it("does not match inflow against outflow", () => {
    // bank credit (inflow) vs books credit (outflow) — opposite signs, must not pair
    const r = reconcile([bank(1, "2026-04-01", "IN", 0, 1000)], [book(1, "2026-04-01", "OUT", 0, 1000)]);
    expect(r.groups).toHaveLength(0);
    expect(r.summary.unmatchedBankCount).toBe(1);
    expect(r.summary.unmatchedBooksCount).toBe(1);
  });
});
