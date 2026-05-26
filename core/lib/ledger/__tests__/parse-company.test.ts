/* Smoke test for parseCompanyLedger — builds a synthetic workbook in memory
   that mirrors a Tally/BC export, then asserts party name, opening balance,
   closing balance + Dr/Cr direction, and transaction count. */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseCompanyLedger } from "../parse-company";

function makeBuffer(): Buffer {
  // Mirrors the Tally-style header layout: cells line up with the indices
  // parseCompanyLedger uses (date=1, doctype=2, docno=4, extdocno=7,
  // tds=11, debit=12, credit=14, balance=15). Header has the keyword
  // anchors ("Date", "Document Type", "Document No", "External Document",
  // "TDS", "Debit", "Credit", "Balance").
  const rows: (string | number | null)[][] = [
    // ── pre-header chrome ──
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    // ── header row (row index 1) ──
    [null, "Date", "Document Type", null, "Document No", null, null, "External Document", null, null, null, "TDS", "Debit", null, "Credit", "Balance"],
    // ── party name appears as a section row after the header (Tally pattern) ──
    ["Test Partner Ltd.", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    // ── opening balance ──
    [null, "01-04-2025", "", null, "Opening Balance", null, null, "", null, null, null, 0, 0, null, 50_000, 50_000],
    // ── transactions ──
    [null, "15-05-2025", "Invoice", null, "C-001", null, null, "INV-100", null, null, null, 0, 0, null, 10_000, 60_000],
    [null, "20-05-2025", "Payment", null, "PAY-1", null, null, "", null, null, null, 0, 5_000, null, 0, 55_000],
    // ── closing balance with explicit Cr marker ──
    [null, "31-05-2025", "", null, "Closing Balance", null, null, "", null, null, null, 0, 0, null, 55_000, 55_000, "Cr."],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Ledger");
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}

describe("parseCompanyLedger", () => {
  const parsed = parseCompanyLedger(makeBuffer());

  it("detects the party name", () => {
    expect(parsed.partyName).toBe("Test Partner Ltd.");
  });

  it("reads opening balance from the marker row", () => {
    expect(parsed.openingBal).toBe(50_000);
  });

  it("reads closing balance and direction", () => {
    expect(parsed.closingRaw).toBe(55_000);
    expect(parsed.closingDrCr).toBe("Cr");
    // Cr → positive sign (company owes partner)
    expect(parsed.closingBal).toBe(55_000);
  });

  it("extracts both real transactions (excludes opening/closing markers)", () => {
    expect(parsed.transactions).toHaveLength(2);
    const inv = parsed.transactions.find((t) => t.docType === "Invoice")!;
    expect(inv.docNo).toBe("C-001");
    expect(inv.extNo).toBe("INV-100");
    expect(inv.credit).toBe(10_000);

    const pay = parsed.transactions.find((t) => t.docType === "Payment")!;
    expect(pay.debit).toBe(5_000);
  });
});

describe("parseCompanyLedger — Dr direction inverts sign", () => {
  it("flips closingBal negative when Dr marker is present", () => {
    const rows: (string | number | null)[][] = [
      [null, "Date", "Document Type", null, "Document No", null, null, "External Document", null, null, null, "TDS", "Debit", null, "Credit", "Balance"],
      [null, "15-05-2025", "Invoice", null, "C-001", null, null, "INV-100", null, null, null, 0, 0, null, 10_000, 60_000],
      [null, "31-05-2025", "", null, "Closing Balance", null, null, "", null, null, null, 0, 0, null, 12_000, 12_000, "Dr."],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Ledger");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const parsed = parseCompanyLedger(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer));
    expect(parsed.closingDrCr).toBe("Dr");
    expect(parsed.closingBal).toBe(-12_000);    // company overpaid
  });
});
