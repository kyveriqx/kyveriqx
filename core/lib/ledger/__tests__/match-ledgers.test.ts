/* Unit tests for the inter-entity matcher.
   Covers each branch of reconcile() against synthetic inputs so the
   algorithm can be tuned without breaking known cases. */

import { describe, it, expect } from "vitest";
import { reconcile } from "../match-ledgers";
import type { CompanyLedger, PartnerLedger } from "../types";

function d(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function makeCompany(partial: Partial<CompanyLedger> = {}): CompanyLedger {
  return {
    partyName: "Test Partner",
    openingBal: 0,
    closingBal: 0,
    closingRaw: 0,
    closingDrCr: "Cr",
    transactions: [],
    minDate: null,
    ...partial,
  };
}

function makePartner(partial: Partial<PartnerLedger> = {}): PartnerLedger {
  return {
    locations: [],
    totalClosing: 0,
    ...partial,
  };
}

describe("reconcile() — invoice matching", () => {
  it("exact match → status 'Matched' when amounts agree within 2", () => {
    const company = makeCompany({
      transactions: [
        { sheet: "S1", date: d("2026-01-15"), docType: "Invoice", docNo: "C-001",
          extNo: "INV-100", tds: 0, debit: 0, credit: 10_000, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const partner = makePartner({
      locations: [{
        location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0,
        transactions: [
          { location: "LOC-A", date: d("2026-01-15"), docType: "Invoice",
            docNo: "INV-100", amount: -10_000, balance: 0 },
        ],
      }],
    });

    const res = reconcile(company, partner);
    expect(res.matchedInvoices).toHaveLength(1);
    expect(res.matchedInvoices[0].status).toBe("Matched");
    expect(res.matchedInvoices[0].amountDiff).toBe(0);
    expect(res.unmatchedCompanyInv).toHaveLength(0);
    expect(res.unmatchedPartnerInv).toHaveLength(0);
  });

  it("status 'TDS Diff' when partner amount > company amount by ~TDS amount", () => {
    const company = makeCompany({
      transactions: [
        { sheet: "S1", date: d("2026-01-15"), docType: "Invoice", docNo: "C-001",
          extNo: "INV-200", tds: 1_000, debit: 0, credit: 9_000, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const partner = makePartner({
      locations: [{
        location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0,
        transactions: [
          { location: "LOC-A", date: d("2026-01-15"), docType: "Invoice",
            docNo: "INV-200", amount: -10_000, balance: 0 },
        ],
      }],
    });

    const res = reconcile(company, partner);
    expect(res.matchedInvoices).toHaveLength(1);
    expect(res.matchedInvoices[0].status).toBe("TDS Diff");
    expect(res.matchedInvoices[0].amountDiff).toBe(1000);
    expect(res.matchedInvoices[0].netDiff).toBe(0);
    expect(res.totalTds).toBe(1000);
  });

  it("status 'Amount Mismatch' when amounts differ more than 2 and TDS doesn't explain it", () => {
    const company = makeCompany({
      transactions: [
        { sheet: "S1", date: d("2026-01-15"), docType: "Invoice", docNo: "C-001",
          extNo: "INV-300", tds: 0, debit: 0, credit: 10_000, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const partner = makePartner({
      locations: [{
        location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0,
        transactions: [
          { location: "LOC-A", date: d("2026-01-15"), docType: "Invoice",
            docNo: "INV-300", amount: -12_000, balance: 0 },
        ],
      }],
    });

    const res = reconcile(company, partner);
    expect(res.matchedInvoices[0].status).toBe("Amount Mismatch");
    expect(res.matchedInvoices[0].amountDiff).toBe(2000);
  });

  it("partial-match fallback uses the segment after the last '/'", () => {
    const company = makeCompany({
      transactions: [
        { sheet: "S1", date: d("2026-01-15"), docType: "Invoice", docNo: "C-001",
          // Company recorded the full hierarchical ref...
          extNo: "FY26/Q3/INV-555", tds: 0, debit: 0, credit: 5_000, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const partner = makePartner({
      locations: [{
        location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0,
        transactions: [
          // ...partner only has the suffix.
          { location: "LOC-A", date: d("2026-01-15"), docType: "Invoice",
            docNo: "INV-555", amount: -5_000, balance: 0 },
        ],
      }],
    });

    const res = reconcile(company, partner);
    expect(res.matchedInvoices).toHaveLength(1);
    expect(res.matchedInvoices[0].invoiceNo).toBe("FY26/Q3/INV-555");
    expect(res.unmatchedCompanyInv).toHaveLength(0);
  });

  it("no ext_no → unmatched with the right reason", () => {
    const company = makeCompany({
      transactions: [
        { sheet: "S1", date: d("2026-01-15"), docType: "Invoice", docNo: "C-001",
          extNo: "", tds: 0, debit: 0, credit: 1_000, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const res = reconcile(company, makePartner());
    expect(res.unmatchedCompanyInv).toHaveLength(1);
    expect(res.unmatchedCompanyInv[0].reason).toMatch(/No external reference/);
  });

  it("partner invoice with no company match shows up in unmatchedPartnerInv", () => {
    const partner = makePartner({
      locations: [{
        location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0,
        transactions: [
          { location: "LOC-A", date: d("2026-01-15"), docType: "Invoice",
            docNo: "ORPHAN-1", amount: -2_500, balance: 0 },
        ],
      }],
    });
    const res = reconcile(makeCompany(), partner);
    expect(res.unmatchedPartnerInv).toHaveLength(1);
    expect(res.unmatchedPartnerInv[0].docNo).toBe("ORPHAN-1");
  });
});

describe("reconcile() — payment matching", () => {
  it("payment matched on exact amount and date within ±5 days", () => {
    // Partner anchors the period; company payment must be >= partner start.
    const company = makeCompany({
      transactions: [
        { sheet: "S1", date: d("2026-01-20"), docType: "Payment", docNo: "PAY-1",
          extNo: "", tds: 0, debit: 5_000, credit: 0, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const partner = makePartner({
      locations: [{
        location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0,
        transactions: [
          { location: "LOC-A", date: d("2026-01-18"), docType: "Receipt",
            docNo: "RCT-9", amount: 5_000, balance: 0 },
        ],
      }],
    });
    const res = reconcile(company, partner);
    expect(res.matchedPayments).toHaveLength(1);
    expect(res.unmatchedCompanyPay).toHaveLength(0);
  });

  it("payment NOT matched when partner date is more than 5 days away", () => {
    const company = makeCompany({
      transactions: [
        { sheet: "S1", date: d("2026-02-05"), docType: "Payment", docNo: "PAY-1",
          extNo: "", tds: 0, debit: 5_000, credit: 0, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const partner = makePartner({
      locations: [{
        location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0,
        transactions: [
          { location: "LOC-A", date: d("2026-01-25"), docType: "Receipt",
            docNo: "RCT-9", amount: 5_000, balance: 0 },
        ],
      }],
    });
    const res = reconcile(company, partner);
    expect(res.matchedPayments).toHaveLength(0);
    expect(res.unmatchedCompanyPay).toHaveLength(1);
  });

  it("payment NOT matched when amounts differ even by 1 rupee", () => {
    const company = makeCompany({
      transactions: [
        { sheet: "S1", date: d("2026-01-16"), docType: "Payment", docNo: "PAY-1",
          extNo: "", tds: 0, debit: 5_001, credit: 0, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const partner = makePartner({
      locations: [{
        location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0,
        transactions: [
          { location: "LOC-A", date: d("2026-01-15"), docType: "Receipt",
            docNo: "RCT-9", amount: 5_000, balance: 0 },
        ],
      }],
    });
    const res = reconcile(company, partner);
    expect(res.matchedPayments).toHaveLength(0);
  });
});

describe("reconcile() — balance gap", () => {
  it("same-direction gap = |partner - company|", () => {
    const company = makeCompany({ closingBal: 1000, closingDrCr: "Cr" });
    const partner = makePartner({ totalClosing: 1500 });
    const res = reconcile(company, partner);
    expect(res.totalGap).toBe(500);
  });

  it("opposite-direction gap = |partner| + |company|", () => {
    // Company says: partner owes us 1000 (companyClosing = -1000)
    // Partner says: we owe them 1500 (partnerClosing = +1500)
    // → real gap is the sum, not the difference.
    const company = makeCompany({ closingBal: -1000, closingDrCr: "Dr" });
    const partner = makePartner({ totalClosing: 1500 });
    const res = reconcile(company, partner);
    expect(res.totalGap).toBe(2500);
  });

  it("zero gap when both books fully agree", () => {
    const company = makeCompany({ closingBal: 0 });
    const partner = makePartner({ totalClosing: 0 });
    const res = reconcile(company, partner);
    expect(res.totalGap).toBe(0);
    expect(res.companySignLabel).toMatch(/ZERO/);
    expect(res.partnerSignLabel).toMatch(/ZERO/);
  });
});

describe("reconcile() — period filter", () => {
  it("drops company transactions before partner's earliest date", () => {
    const company = makeCompany({
      transactions: [
        // Before partner start — dropped.
        { sheet: "S1", date: d("2025-12-01"), docType: "Invoice", docNo: "OLD",
          extNo: "OLD-1", tds: 0, debit: 0, credit: 100, balance: 0, opening: 0, closing: 0 },
        // Inside period — kept.
        { sheet: "S1", date: d("2026-01-20"), docType: "Invoice", docNo: "NEW",
          extNo: "NEW-1", tds: 0, debit: 0, credit: 200, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const partner = makePartner({
      locations: [{
        location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0,
        transactions: [
          { location: "LOC-A", date: d("2026-01-15"), docType: "Invoice",
            docNo: "NEW-1", amount: -200, balance: 0 },
        ],
      }],
    });
    const res = reconcile(company, partner);
    expect(res.matchedInvoices).toHaveLength(1);
    expect(res.matchedInvoices[0].invoiceNo).toBe("NEW-1");
    // The dropped OLD-1 invoice should NOT appear as unmatched — it's outside scope.
    expect(res.unmatchedCompanyInv).toHaveLength(0);
  });
});

describe("reconcile() — location summary", () => {
  it("counts matched invoices per location and flags Settled/Outstanding", () => {
    const company = makeCompany({
      transactions: [
        { sheet: "S1", date: d("2026-01-15"), docType: "Invoice", docNo: "C-1",
          extNo: "A-1", tds: 0, debit: 0, credit: 100, balance: 0, opening: 0, closing: 0 },
        { sheet: "S1", date: d("2026-01-16"), docType: "Invoice", docNo: "C-2",
          extNo: "B-1", tds: 0, debit: 0, credit: 200, balance: 0, opening: 0, closing: 0 },
      ],
    });
    const partner = makePartner({
      locations: [
        { location: "LOC-A", partyName: "A", openingBal: 0, closingBal: 0.5,
          transactions: [
            { location: "LOC-A", date: d("2026-01-15"), docType: "Invoice",
              docNo: "A-1", amount: -100, balance: 0 },
          ] },
        { location: "LOC-B", partyName: "B", openingBal: 0, closingBal: 1000,
          transactions: [
            { location: "LOC-B", date: d("2026-01-16"), docType: "Invoice",
              docNo: "B-1", amount: -200, balance: 0 },
          ] },
      ],
    });
    const res = reconcile(company, partner);
    expect(res.locationSummary).toHaveLength(2);
    const a = res.locationSummary.find((l) => l.location === "LOC-A")!;
    const b = res.locationSummary.find((l) => l.location === "LOC-B")!;
    expect(a.matchedInv).toBe(1);
    expect(a.status).toBe("Settled");        // |0.5| < 1
    expect(b.matchedInv).toBe(1);
    expect(b.status).toBe("Outstanding");    // 1000 > 1
  });
});
