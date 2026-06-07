import { describe, it, expect } from "vitest";
import { reconcile } from "./match";
import { DEFAULT_OPTIONS } from "./types";
import type { BankTxn, BooksTxn, SettlementRow } from "./types";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

function bank(row: number, date: string | null, desc: string, debit: number, credit: number): BankTxn {
  return { row, file: "bank.xlsx", fileRow: row, date: date ? d(date) : null, description: desc, debit, credit, signed: credit - debit, balance: null };
}
function book(row: number, date: string | null, desc: string, debit: number, credit: number): BooksTxn {
  return { row, file: "books.xlsx", fileRow: row, date: date ? d(date) : null, description: desc, debit, credit, signed: debit - credit, balance: null };
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
      { row: 1, file: "settlement.xlsx", fileRow: 1, utr: "UTR123", settledAt: d("2026-04-15"), amount: 9764, fee: 200, tax: 36 },
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

  it("pass 5a-wide: a large item booked a few days apart still matches 1:1", () => {
    // Loan EMI: books post it 8 days before the bank debits it — beyond the ±3
    // tolerant window, inside the 15-day wide mop-up. Both are money out (equal
    // signed), so they must pair instead of sitting unmatched on both sides.
    const r = reconcile(
      [bank(1, "2026-04-20", "LOAN EMI", 558950, 0)],
      [book(1, "2026-04-12", "Term loan EMI", 0, 558950)],
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("date-tolerant");
    expect(r.groups[0].confidence).toBe("low");
    expect(r.groups[0].note).toContain("wide-date");
    expect(r.summary.unmatchedBankCount).toBe(0);
    expect(r.summary.unmatchedBooksCount).toBe(0);
  });

  it("wide-date mop-up never steals a row from a UPI group", () => {
    // The group pass runs first, so the three same-day book rows aggregate to
    // the 6000 bank line; the lone far 3000 bank line has no free partner left.
    const r = reconcile(
      [bank(1, "2026-04-10", "UPI CR", 0, 6000), bank(2, "2026-04-25", "NEFT", 0, 3000)],
      [book(1, "2026-04-10", "A", 1000, 0), book(2, "2026-04-10", "B", 2000, 0), book(3, "2026-04-10", "C", 3000, 0)],
    );
    const grp = r.groups.find((g) => g.method === "group-exact");
    expect(grp?.booksRows).toHaveLength(3);
    expect(r.summary.unmatchedBankCount).toBe(1);
  });

  it("pass 5b: far-apart equal-and-opposite books pair nets out as contra", () => {
    // An own-account transfer booked out (30-Jun) then back in (07-Jul): 7 days
    // apart, no "reversal" wording — too far/quiet for pass 3, but it never hit
    // the bank on net, so it must leave the exception list as a net-zero contra.
    const r = reconcile(
      [],
      [
        book(1, "2026-06-30", "HDFC BANK 50200053122539", 0, 2_000_000),
        book(2, "2026-07-07", "HDFC BANK 50200053122539", 2_000_000, 0),
      ],
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("contra");
    expect(r.groups[0].booksRows).toHaveLength(2);
    expect(r.groups[0].bankAmount + r.groups[0].booksAmount).toBe(0);
    expect(r.summary.unmatchedBooksCount).toBe(0);
  });

  it("contra never steals a pair the bank can legitimately match", () => {
    // A +50k receipt that matches a real bank credit must not be grabbed by a
    // -50k payment as a contra: the group passes run first, so only the genuine
    // leftover (the -50k payment) is left unmatched here.
    const r = reconcile(
      [bank(1, "2026-04-01", "NEFT IN", 0, 50_000)],
      [book(1, "2026-04-01", "Sales", 50_000, 0), book(2, "2026-04-20", "Vendor pay", 0, 50_000)],
    );
    expect(r.groups.find((g) => g.method === "exact")).toBeTruthy();
    expect(r.groups.some((g) => g.method === "contra")).toBe(false);
    expect(r.summary.unmatchedBooksCount).toBe(1);
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

describe("reconcile — round-off (paise) tolerance", () => {
  it("pairs a bank line carrying paise with whole-rupee books (≤ ₹1 gap)", () => {
    // Bank shows 794097.76, books were keyed as 794098 — the same money.
    const r = reconcile(
      [bank(1, "2026-04-01", "RTGS IN", 0, 794097.76)],
      [book(1, "2026-04-01", "Customer receipt", 794098, 0)],
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("rounding");
    expect(r.groups[0].fee).toBe(0.24);          // the round-off gap, surfaced in "Fee / diff"
    expect(r.groups[0].note).toContain("round-off gap ₹0.24");
    expect(r.summary.feesIdentified).toBe(0);    // a rounding gap is NOT a gateway fee
    expect(r.summary.unmatchedBankCount).toBe(0);
    expect(r.summary.unmatchedBooksCount).toBe(0);
  });

  it("absorbs a tiny 5-paise gap", () => {
    const r = reconcile(
      [bank(1, "2026-04-02", "NEFT", 0, 47988.95)],
      [book(1, "2026-04-02", "Sales", 47989, 0)],
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].method).toBe("rounding");
    expect(r.groups[0].fee).toBe(0.05);
  });

  it("exact still wins — rounding only mops up what exact passes leave", () => {
    const r = reconcile(
      [bank(1, "2026-04-01", "A", 0, 1000), bank(2, "2026-04-02", "B", 0, 5000.5)],
      [book(1, "2026-04-01", "A", 1000, 0), book(2, "2026-04-02", "B", 5001, 0)],
    );
    expect(r.groups.find((g) => g.method === "exact")?.bankRows).toEqual([1]);
    expect(r.groups.find((g) => g.method === "rounding")?.fee).toBe(0.5);
    expect(r.summary.unmatchedBankCount).toBe(0);
    expect(r.summary.unmatchedBooksCount).toBe(0);
  });

  it("does not pair beyond the ₹1 ceiling", () => {
    const r = reconcile(
      [bank(1, "2026-04-01", "A", 0, 1000)],
      [book(1, "2026-04-01", "A", 1001.5, 0)],
    );
    expect(r.groups).toHaveLength(0);
    expect(r.summary.unmatchedBankCount).toBe(1);
    expect(r.summary.unmatchedBooksCount).toBe(1);
  });

  it("is disabled when the tolerance is 0", () => {
    const r = reconcile(
      [bank(1, "2026-04-01", "RTGS", 0, 794097.76)],
      [book(1, "2026-04-01", "Receipt", 794098, 0)],
      { ...DEFAULT_OPTIONS, roundingToleranceRupees: 0 },
    );
    expect(r.groups).toHaveLength(0);
    expect(r.summary.unmatchedBankCount).toBe(1);
  });
});
