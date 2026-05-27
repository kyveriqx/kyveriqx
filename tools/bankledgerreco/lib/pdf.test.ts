/* Unit tests for the PDF → matrix reconstruction (no real PDF needed — we
   feed synthetic positioned text items, the way pdf.js would emit them). */

import { describe, it, expect } from "vitest";
import { itemsToMatrix, hasSelectableText, type TextItem } from "./pdf";

type Tup = [x: number, str: string, w: number];
const mk = (y: number, items: Tup[], page = 1): TextItem[] =>
  items.map(([x, str, w]) => ({ str, x, y, w, page }));

// A statement laid out in 5 columns (Date | Narration | Withdrawal | Deposit |
// Balance) with: a title preamble above the header, a wrapped narration line,
// debit and credit transactions.
const items: TextItem[] = [
  ...mk(760, [[50, "ACMEBANK", 40]]),                                   // preamble (dropped)
  ...mk(700, [[50, "Date", 25], [120, "Narration", 55], [320, "Withdrawal", 58], [410, "Deposit", 42], [500, "Balance", 42]]),
  ...mk(680, [[50, "01/04/2026", 48], [120, "NEFT", 26], [150, "FROM", 28], [182, "CUST", 28], [214, "X", 8], [412, "1,000.00", 40], [502, "1,000.00", 40]]),
  ...mk(662, [[50, "10/04/2026", 48], [120, "UPI", 22], [146, "CR", 16], [166, "CONSOLIDATED", 78], [412, "7,500.00", 40], [502, "8,500.00", 40]]),
  ...mk(650, [[120, "REF", 24], [148, "1234", 30], [182, "BATCH", 34]]),  // wrapped narration
  ...mk(632, [[50, "12/04/2026", 48], [120, "RAZORPAY", 56], [178, "SETTLEMENT", 66], [412, "9,764.00", 40], [498, "18,264.00", 46]]),
  ...mk(614, [[50, "13/04/2026", 48], [120, "SMS", 26], [148, "CHRG", 30], [182, "GST", 24], [322, "50.00", 32]]),
];

describe("itemsToMatrix — PDF table reconstruction", () => {
  const matrix = itemsToMatrix(items);

  it("trims the preamble and keeps header + 4 transaction rows", () => {
    expect(matrix).toHaveLength(5); // header + 4 txns (wrap folded, preamble dropped)
    expect(matrix[0]).toEqual(["Date", "Narration", "Withdrawal", "Deposit", "Balance"]);
  });

  it("places dates, narration and amounts in the right columns", () => {
    expect(matrix[1][0]).toBe("01/04/2026");
    expect(matrix[1][1]).toBe("NEFT FROM CUST X");
    expect(matrix[1][3]).toBe("1,000.00");          // deposit
    expect(matrix[4][0]).toBe("13/04/2026");
    expect(matrix[4][2]).toBe("50.00");             // withdrawal
  });

  it("folds a wrapped narration line into the previous transaction", () => {
    expect(matrix[2][1]).toBe("UPI CR CONSOLIDATED REF 1234 BATCH");
    expect(matrix[2][3]).toBe("7,500.00");          // amount untouched by the wrap
  });
});

describe("hasSelectableText — scanned-PDF guard", () => {
  it("is false when there is no real text (scanned image)", () => {
    expect(hasSelectableText([])).toBe(false);
    expect(hasSelectableText([{ str: "x", x: 0, y: 0, w: 1 }])).toBe(false);
  });
  it("is true for a digital PDF with extracted text", () => {
    expect(hasSelectableText(items)).toBe(true);
  });
});
