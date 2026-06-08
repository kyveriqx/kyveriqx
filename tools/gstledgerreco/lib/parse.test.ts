import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseGstr2bJson, parseGstr2aJson, parseGstr1Json, parseGstnDate, looksLikeJson } from "./parse-gst-json";
import { parsePurchaseRegister, parseSalesRegister, mergeInvoices, aggregateRegister, toNum, toDate, pickHeader } from "./parse-register";
import { normalizeGstin, normalizeInvoiceNo } from "./types";
import type { GstInvoice } from "./types";

// ── helpers ──────────────────────────────────────────────────────────

function bufFromJson(o: unknown): Buffer {
  return Buffer.from(JSON.stringify(o), "utf8");
}

function bufFromSheet(headers: string[], rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(out);
}

// ── normalisers ──────────────────────────────────────────────────────

describe("normalizeInvoiceNo", () => {
  it("treats punctuation-only differences as equal", () => {
    expect(normalizeInvoiceNo("INV-001")).toBe(normalizeInvoiceNo("INV/001"));
    expect(normalizeInvoiceNo("INV-001")).toBe(normalizeInvoiceNo("inv 001"));
    // Leading zeros inside numeric runs are stripped: "001" → "1", "27" stays.
    expect(normalizeInvoiceNo("S/2026-27/001")).toBe("S2026271");
  });
  it("treats leading-zero differences as equal", () => {
    expect(normalizeInvoiceNo("GLT/0826/25-26")).toBe(normalizeInvoiceNo("GLT/826/25-26"));
    expect(normalizeInvoiceNo("INV-001")).toBe(normalizeInvoiceNo("INV-1"));
    // An all-zero run collapses to a single "0", not "".
    expect(normalizeInvoiceNo("X/000")).toBe("X0");
  });
});

describe("normalizeGstin", () => {
  it("uppercases and strips whitespace", () => {
    expect(normalizeGstin(" 29aabcu9603r1zj ")).toBe("29AABCU9603R1ZJ");
  });
});

// ── GST JSON parsers ─────────────────────────────────────────────────

describe("parseGstnDate", () => {
  it("accepts DD-MM-YYYY (the portal's format)", () => {
    const d = parseGstnDate("15-04-2026");
    expect(d?.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
  it("accepts DD/MM/YYYY", () => {
    const d = parseGstnDate("15/04/2026");
    expect(d?.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
  it("accepts YYYY-MM-DD", () => {
    const d = parseGstnDate("2026-04-15");
    expect(d?.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
  it("returns null on garbage", () => {
    expect(parseGstnDate("not-a-date")).toBeNull();
    expect(parseGstnDate(null)).toBeNull();
  });
});

describe("parseGstr2bJson", () => {
  it("flattens data.docdata.b2b and sets itcEligible / filedAt", () => {
    const json = {
      data: {
        rtnprd: "042026",
        gstin: "29AABCU9603R1ZJ",
        docdata: {
          b2b: [
            {
              ctin: "29AABCT2727Q1ZH",
              trdnm: "Acme Supplies",
              supfildt: "11-05-2026",
              inv: [
                { inum: "INV-001", dt: "01-04-2026", val: 11800, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0, itcavl: "Y", rsn: "" },
                { inum: "INV-002", dt: "15-04-2026", val: 23600, txval: 20000, iamt: 0, camt: 1800, samt: 1800, csamt: 0, itcavl: "N", rsn: "POS overruled" },
              ],
            },
          ],
        },
      },
    };
    const { invoices, notes } = parseGstr2bJson(bufFromJson(json), "2b.json");
    expect(notes).toEqual([]);
    expect(invoices).toHaveLength(2);
    expect(invoices[0].partyGstin).toBe("29AABCT2727Q1ZH");
    expect(invoices[0].partyName).toBe("Acme Supplies");
    expect(invoices[0].source).toBe("gstr2b");
    expect(invoices[0].totalTax).toBe(1800);
    expect(invoices[0].itcEligible).toBe(true);
    expect(invoices[0].filedAt?.toISOString()).toBe("2026-05-11T00:00:00.000Z");
    expect(invoices[1].itcEligible).toBe(false);
    expect(invoices[1].itcReason).toBe("POS overruled");
  });

  it("notes when the b2b section is missing", () => {
    const { invoices, notes } = parseGstr2bJson(bufFromJson({ data: {} }), "empty.json");
    expect(invoices).toHaveLength(0);
    expect(notes[0]).toMatch(/no B2B section/);
  });

  it("notes when JSON is malformed", () => {
    const { invoices, notes } = parseGstr2bJson(Buffer.from("not-json"), "bad.json");
    expect(invoices).toHaveLength(0);
    expect(notes[0]).toMatch(/JSON parse failed/);
  });
});

describe("parseGstr2aJson", () => {
  it("accepts idt instead of dt and reads the b2b envelope", () => {
    const json = {
      b2b: [
        { ctin: "29AAAAA0000A1Z5", inv: [{ inum: "S-99", idt: "20-03-2026", val: 1180, txval: 1000, iamt: 180, camt: 0, samt: 0, csamt: 0 }] },
      ],
    };
    const { invoices } = parseGstr2aJson(bufFromJson(json), "2a.json");
    expect(invoices).toHaveLength(1);
    expect(invoices[0].source).toBe("gstr2a");
    expect(invoices[0].invoiceDate?.toISOString()).toBe("2026-03-20T00:00:00.000Z");
    expect(invoices[0].itcEligible).toBeNull();
  });
});

describe("parseGstr1Json", () => {
  it("sums per-item tax inside itms[].itm_det", () => {
    const json = {
      gstin: "29AABCU9603R1ZJ",
      fp: "042026",
      b2b: [
        {
          ctin: "29CUSTM1234A1Z9",
          inv: [
            {
              inum: "S-001",
              idt: "10-04-2026",
              val: 11800,
              itms: [
                { num: 1, itm_det: { txval: 6000, iamt: 0, camt: 540, samt: 540, csamt: 0 } },
                { num: 2, itm_det: { txval: 4000, iamt: 0, camt: 360, samt: 360, csamt: 0 } },
              ],
            },
          ],
        },
      ],
    };
    const { invoices } = parseGstr1Json(bufFromJson(json), "1.json");
    expect(invoices).toHaveLength(1);
    expect(invoices[0].taxableValue).toBe(10000);
    expect(invoices[0].cgst).toBe(900);
    expect(invoices[0].sgst).toBe(900);
    expect(invoices[0].totalTax).toBe(1800);
    expect(invoices[0].source).toBe("gstr1");
  });
});

describe("looksLikeJson", () => {
  it("recognises object / array JSON, ignores BOMs and whitespace", () => {
    expect(looksLikeJson(Buffer.from("   {"))).toBe(true);
    expect(looksLikeJson(Buffer.from([0xef, 0xbb, 0xbf, 0x7b]))).toBe(true);
    expect(looksLikeJson(Buffer.from("["))).toBe(true);
    expect(looksLikeJson(Buffer.from("Date,Amount\n"))).toBe(false);
  });
});

// ── Register parsers ─────────────────────────────────────────────────

describe("toNum / toDate / pickHeader", () => {
  it("strips ₹ and commas", () => {
    expect(toNum("₹1,200.50")).toBe(1200.5);
    expect(toNum("1,234 CR")).toBe(1234);
  });
  it("parses DD/MM/YYYY", () => {
    expect(toDate("01/04/2026")?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
  it("does token-set fuzzy header matching", () => {
    expect(pickHeader(["Supplier GSTIN", "Invoice No"], ["GSTIN"])).toBe("Supplier GSTIN");
    expect(pickHeader(["GST No.", "Bill Date"], ["GSTIN"])).toBeNull();
  });
});

describe("parsePurchaseRegister", () => {
  it("reads a Tally-style XLSX with per-head IGST/CGST/SGST", () => {
    const buf = bufFromSheet(
      ["Supplier GSTIN", "Supplier Name", "Invoice No", "Invoice Date", "Taxable Value", "IGST", "CGST", "SGST", "Invoice Value"],
      [
        ["29AABCT2727Q1ZH", "Acme Supplies", "INV-001", "01/04/2026", 10000, 0, 900, 900, 11800],
        ["29SUP00001A1Z1", "Beta Traders", "B/26-27/05", "02/04/2026", 5000, 900, 0, 0, 5900],
      ],
    );
    const { invoices, columns } = parsePurchaseRegister(buf, "purchase.xlsx");
    expect(columns.gstin).toBe("Supplier GSTIN");
    expect(columns.invoiceNo).toBe("Invoice No");
    expect(invoices).toHaveLength(2);
    expect(invoices[0].partyGstin).toBe("29AABCT2727Q1ZH");
    expect(invoices[0].source).toBe("purchase");
    expect(invoices[0].totalTax).toBe(1800);
    expect(invoices[0].invoiceValue).toBe(11800);
    expect(invoices[1].invoiceDate?.toISOString()).toBe("2026-04-02T00:00:00.000Z");
  });

  it("falls back to a single Tax Amount column", () => {
    const buf = bufFromSheet(
      ["GSTIN", "Invoice No", "Invoice Date", "Taxable Value", "Tax Amount"],
      [["29AABCT2727Q1ZH", "INV-009", "10/04/2026", 1000, 180]],
    );
    const { invoices } = parsePurchaseRegister(buf, "purchase.xlsx");
    expect(invoices[0].totalTax).toBe(180);
    expect(invoices[0].invoiceValue).toBe(1180);
  });

  it("skips blank noise rows", () => {
    const buf = bufFromSheet(
      ["GSTIN", "Invoice No", "Invoice Date", "Taxable Value"],
      [
        ["", "", "", ""],
        ["29AABCT2727Q1ZH", "INV-001", "01/04/2026", 10000],
        ["", "", "", ""],
      ],
    );
    const { invoices } = parsePurchaseRegister(buf, "p.xlsx");
    expect(invoices).toHaveLength(1);
  });
});

describe("parseSalesRegister", () => {
  it("tags rows with source=sales", () => {
    const buf = bufFromSheet(
      ["Customer GSTIN", "Invoice No", "Invoice Date", "Taxable Value", "IGST", "CGST", "SGST"],
      [["29CUSTM1234A1Z9", "S-001", "10/04/2026", 10000, 0, 900, 900]],
    );
    const { invoices } = parseSalesRegister(buf, "sales.xlsx");
    expect(invoices[0].source).toBe("sales");
    expect(invoices[0].partyGstin).toBe("29CUSTM1234A1Z9");
  });
});

describe("mergeInvoices", () => {
  it("re-numbers rows globally and stamps file", () => {
    const a = [{ row: 1, file: "", fileRow: 1, source: "purchase" as const, partyGstin: "G1", partyName: "", invoiceNo: "A", invoiceDate: null, taxableValue: 100, igst: 0, cgst: 9, sgst: 9, cess: 0, totalTax: 18, invoiceValue: 118, itcEligible: null, itcReason: null, filedAt: null }];
    const b = [{ row: 1, file: "", fileRow: 1, source: "purchase" as const, partyGstin: "G2", partyName: "", invoiceNo: "B", invoiceDate: null, taxableValue: 200, igst: 0, cgst: 18, sgst: 18, cess: 0, totalTax: 36, invoiceValue: 236, itcEligible: null, itcReason: null, filedAt: null }];
    const { merged, sources } = mergeInvoices([
      { file: "p1.xlsx", invoices: a },
      { file: "p2.xlsx", invoices: b },
    ]);
    expect(merged.map((m) => m.row)).toEqual([1, 2]);
    expect(merged.map((m) => m.file)).toEqual(["p1.xlsx", "p2.xlsx"]);
    expect(sources).toEqual([
      { file: "p1.xlsx", rows: 1, rowStart: 1, rowEnd: 1 },
      { file: "p2.xlsx", rows: 1, rowStart: 2, rowEnd: 2 },
    ]);
  });
});

describe("aggregateRegister", () => {
  function line(over: Partial<GstInvoice>): GstInvoice {
    return {
      row: 0, file: "p.xlsx", fileRow: 0, source: "purchase",
      partyGstin: "29AABCT2727Q1ZH", partyName: "Acme", invoiceNo: "INV-1",
      invoiceDate: null, taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0,
      totalTax: 0, invoiceValue: 0, itcEligible: null, itcReason: null, filedAt: null,
      ...over,
    };
  }

  it("collapses line-level rows of one invoice and sums the money", () => {
    const out = aggregateRegister([
      line({ fileRow: 1, taxableValue: 1000, cgst: 90, sgst: 90, totalTax: 180, invoiceValue: 1180 }),
      line({ fileRow: 2, taxableValue: 2000, cgst: 180, sgst: 180, totalTax: 360, invoiceValue: 2360 }),
      line({ fileRow: 3, taxableValue: 500, cgst: 45, sgst: 45, totalTax: 90, invoiceValue: 590 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].taxableValue).toBe(3500);
    expect(out[0].totalTax).toBe(630);
    expect(out[0].invoiceValue).toBe(4130);
    expect(out[0].mergedLines).toBe(3);
    expect(out[0].fileRow).toBe(1); // keeps the first line's row
  });

  it("keeps distinct invoices separate and collapses leading-zero variants", () => {
    const out = aggregateRegister([
      line({ invoiceNo: "GLT/0826/25-26", taxableValue: 100, totalTax: 18 }),
      line({ invoiceNo: "GLT/826/25-26", taxableValue: 200, totalTax: 36 }),
      line({ invoiceNo: "OTHER-1", taxableValue: 50, totalTax: 9 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].taxableValue).toBe(300); // the two GLT forms merged
    expect(out[0].mergedLines).toBe(2);
    expect(out[1].invoiceNo).toBe("OTHER-1");
  });

  it("passes through rows that lack a usable key", () => {
    const out = aggregateRegister([
      line({ partyGstin: "", invoiceNo: "", taxableValue: 30088, totalTax: 0 }),
      line({ partyGstin: "", invoiceNo: "", taxableValue: 11750, totalTax: 0 }),
    ]);
    expect(out).toHaveLength(2); // unkeyable rows are never merged together
    expect(out[0].mergedLines).toBe(1);
  });

  it("prefers the longest non-empty party name across lines", () => {
    const out = aggregateRegister([
      line({ partyName: "Acme" }),
      line({ partyName: "Acme Supplies Private Limited" }),
    ]);
    expect(out[0].partyName).toBe("Acme Supplies Private Limited");
  });
});
