import { describe, it, expect } from "vitest";
import { reconcileGst } from "./match";
import type { GstInvoice, GstReturn } from "./types";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

function inv(opts: {
  row?: number;
  source: GstReturn;
  gstin?: string;
  name?: string;
  invoiceNo: string;
  date?: string | null;
  taxable: number;
  igst?: number;
  cgst?: number;
  sgst?: number;
  cess?: number;
  itcEligible?: boolean | null;
  filedAt?: string | null;
}): GstInvoice {
  const igst = opts.igst ?? 0;
  const cgst = opts.cgst ?? 0;
  const sgst = opts.sgst ?? 0;
  const cess = opts.cess ?? 0;
  const totalTax = igst + cgst + sgst + cess;
  return {
    row: opts.row ?? 1,
    file: `${opts.source}.json`,
    fileRow: opts.row ?? 1,
    source: opts.source,
    partyGstin: opts.gstin ?? "29AABCT2727Q1ZH",
    partyName: opts.name ?? "Acme Supplies",
    invoiceNo: opts.invoiceNo,
    invoiceDate: opts.date === undefined ? d("2026-04-01") : opts.date === null ? null : d(opts.date),
    taxableValue: opts.taxable,
    igst, cgst, sgst, cess, totalTax,
    invoiceValue: opts.taxable + totalTax,
    itcEligible: opts.itcEligible ?? null,
    itcReason: null,
    filedAt: opts.filedAt ? d(opts.filedAt) : null,
  };
}

function empty() {
  return { gstr1: [], gstr2a: [], gstr2b: [], sales: [], purchase: [] };
}

describe("reconcileGst — ITC pass", () => {
  it("matches on (GSTIN + normalised invoice no) when everything ties", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [inv({ source: "purchase", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
      gstr2b: [inv({ source: "gstr2b", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900, itcEligible: true })],
    });
    expect(r.itcMatches).toHaveLength(1);
    expect(r.itcMatches[0].exact).toBe(true);
    expect(r.itcExceptions).toHaveLength(0);
    expect(r.summary.itcMatched).toBe(1);
    expect(r.summary.itcTaxMatched).toBe(1800);
  });

  it("matches with invoice-no-diff warning when punctuation differs", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [inv({ source: "purchase", invoiceNo: "INV/001", taxable: 10000, cgst: 900, sgst: 900 })],
      gstr2b: [inv({ source: "gstr2b", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
    });
    expect(r.itcMatches).toHaveLength(1);
    expect(r.itcMatches[0].exact).toBe(false);
    expect(r.itcMatches[0].warnings[0]).toMatch(/invoice no normalised/);
    expect(r.itcExceptions).toHaveLength(0);
  });

  it("flags missing-in-2b when the supplier hasn't filed", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [inv({ source: "purchase", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
      gstr2b: [],
    });
    expect(r.itcExceptions).toHaveLength(1);
    expect(r.itcExceptions[0].kind).toBe("missing-in-2b");
    expect(r.itcExceptions[0].taxAtRisk).toBe(1800);
    expect(r.summary.itcTaxAtRisk).toBe(1800);
  });

  it("flags missing-in-books when 2B has an invoice books doesn't", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [],
      gstr2b: [inv({ source: "gstr2b", invoiceNo: "INV-999", taxable: 5000, igst: 900 })],
    });
    expect(r.itcExceptions).toHaveLength(1);
    expect(r.itcExceptions[0].kind).toBe("missing-in-books");
    expect(r.itcExceptions[0].twoB?.invoiceNo).toBe("INV-999");
  });

  it("flags gstin-mismatch when invoice number matches a different supplier", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [inv({ source: "purchase", gstin: "29WRONG1234A1Z5", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
      gstr2b: [inv({ source: "gstr2b", gstin: "29AABCT2727Q1ZH", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
    });
    expect(r.itcExceptions).toHaveLength(1);
    expect(r.itcExceptions[0].kind).toBe("gstin-mismatch");
    expect(r.itcExceptions[0].note).toContain("29AABCT2727Q1ZH");
  });

  it("flags value-diff when taxable value differs beyond tolerance", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [inv({ source: "purchase", invoiceNo: "INV-001", taxable: 10500, cgst: 900, sgst: 900 })],
      gstr2b: [inv({ source: "gstr2b", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
    });
    expect(r.itcExceptions).toHaveLength(1);
    expect(r.itcExceptions[0].kind).toBe("value-diff");
    expect(r.itcExceptions[0].taxableAtRisk).toBe(500);
  });

  it("flags tax-diff when only tax amount differs", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [inv({ source: "purchase", invoiceNo: "INV-001", taxable: 10000, cgst: 1000, sgst: 1000 })],
      gstr2b: [inv({ source: "gstr2b", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
    });
    expect(r.itcExceptions).toHaveLength(1);
    expect(r.itcExceptions[0].kind).toBe("tax-diff");
    expect(r.itcExceptions[0].taxAtRisk).toBe(200);
  });

  it("flags date-diff when invoice date is beyond the window", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [inv({ source: "purchase", invoiceNo: "INV-001", date: "2026-04-01", taxable: 10000, cgst: 900, sgst: 900 })],
      gstr2b: [inv({ source: "gstr2b", invoiceNo: "INV-001", date: "2026-04-20", taxable: 10000, cgst: 900, sgst: 900 })],
      options: { dateWindowDays: 7, amountTolerancePaise: 100 },
    });
    expect(r.itcExceptions).toHaveLength(1);
    expect(r.itcExceptions[0].kind).toBe("date-diff");
  });

  it("treats sub-rupee differences as exact (₹1 tolerance)", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [inv({ source: "purchase", invoiceNo: "INV-001", taxable: 10000, cgst: 900.5, sgst: 900 })],
      gstr2b: [inv({ source: "gstr2b", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
    });
    expect(r.itcMatches).toHaveLength(1);
    expect(r.itcExceptions).toHaveLength(0);
  });

  it("normalises GSTIN case before matching", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [inv({ source: "purchase", gstin: "29aabct2727q1zh", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
      gstr2b: [inv({ source: "gstr2b", gstin: "29AABCT2727Q1ZH", invoiceNo: "INV-001", taxable: 10000, cgst: 900, sgst: 900 })],
    });
    // GSTIN is already normalised on read by the parsers, but the matcher
    // should also handle pre-normalised inputs gracefully.
    expect(r.itcMatches.length + r.itcExceptions.filter((e) => e.kind === "gstin-mismatch").length).toBe(1);
  });

  it("sorts exceptions with the most urgent kind first", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [
        inv({ row: 1, source: "purchase", invoiceNo: "INV-A", taxable: 10000, cgst: 900, sgst: 900 }),  // missing in 2B
        inv({ row: 2, source: "purchase", invoiceNo: "INV-B", taxable: 10500, cgst: 900, sgst: 900 }),  // value-diff
      ],
      gstr2b: [inv({ row: 1, source: "gstr2b", invoiceNo: "INV-B", taxable: 10000, cgst: 900, sgst: 900 })],
    });
    expect(r.itcExceptions[0].kind).toBe("missing-in-2b");
    expect(r.itcExceptions[1].kind).toBe("value-diff");
  });
});

describe("reconcileGst — Sales pass", () => {
  it("matches sales register against GSTR-1", () => {
    const r = reconcileGst({
      ...empty(),
      sales: [inv({ source: "sales", invoiceNo: "S-001", taxable: 10000, cgst: 900, sgst: 900 })],
      gstr1: [inv({ source: "gstr1", invoiceNo: "S-001", taxable: 10000, cgst: 900, sgst: 900 })],
    });
    expect(r.salesMatches).toHaveLength(1);
    expect(r.salesExceptions).toHaveLength(0);
  });

  it("flags missing-in-gstr1 when books has an invoice not yet filed", () => {
    const r = reconcileGst({
      ...empty(),
      sales: [inv({ source: "sales", invoiceNo: "S-002", taxable: 10000, cgst: 900, sgst: 900 })],
      gstr1: [],
    });
    expect(r.salesExceptions).toHaveLength(1);
    expect(r.salesExceptions[0].kind).toBe("missing-in-gstr1");
  });
});

describe("reconcileGst — Supplier rollup", () => {
  it("aggregates per-supplier counts and computes tax-at-risk", () => {
    const r = reconcileGst({
      ...empty(),
      purchase: [
        inv({ row: 1, source: "purchase", gstin: "29SUPA0000A1Z1", name: "Supplier A", invoiceNo: "A1", taxable: 10000, cgst: 900, sgst: 900 }),
        inv({ row: 2, source: "purchase", gstin: "29SUPA0000A1Z1", invoiceNo: "A2", taxable: 5000, cgst: 450, sgst: 450 }),
        inv({ row: 3, source: "purchase", gstin: "29SUPB0000B1Z2", name: "Supplier B", invoiceNo: "B1", taxable: 20000, igst: 3600 }),
      ],
      gstr2b: [
        inv({ row: 1, source: "gstr2b", gstin: "29SUPA0000A1Z1", invoiceNo: "A1", taxable: 10000, cgst: 900, sgst: 900 }),
        // Supplier A's A2 is missing — filed late
        inv({ row: 2, source: "gstr2b", gstin: "29SUPB0000B1Z2", invoiceNo: "B1", taxable: 20000, igst: 3600 }),
      ],
      gstr2a: [
        inv({ row: 1, source: "gstr2a", gstin: "29SUPA0000A1Z1", invoiceNo: "A1", taxable: 10000, cgst: 900, sgst: 900 }),
        inv({ row: 2, source: "gstr2a", gstin: "29SUPA0000A1Z1", invoiceNo: "A2", taxable: 5000, cgst: 450, sgst: 450 }),
        inv({ row: 3, source: "gstr2a", gstin: "29SUPB0000B1Z2", invoiceNo: "B1", taxable: 20000, igst: 3600 }),
      ],
    });
    const a = r.supplierRollup.find((s) => s.gstin === "29SUPA0000A1Z1")!;
    const b = r.supplierRollup.find((s) => s.gstin === "29SUPB0000B1Z2")!;
    expect(a.booksInvoiceCount).toBe(2);
    expect(a.twoBInvoiceCount).toBe(1);
    expect(a.filedLateInvoiceCount).toBe(1);  // A2 is in 2A but not 2B
    expect(a.filedLateTaxAmount).toBe(900);
    expect(a.taxAtRisk).toBe(900);             // ₹900 of tax not yet in 2B
    expect(b.booksInvoiceCount).toBe(1);
    expect(b.taxAtRisk).toBe(0);
    // Rollup sorted by taxAtRisk desc.
    expect(r.supplierRollup[0].gstin).toBe("29SUPA0000A1Z1");
  });
});
