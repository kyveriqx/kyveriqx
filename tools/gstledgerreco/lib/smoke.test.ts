/* End-to-end smoke test: realistic GSTR-2B JSON + 2A JSON + GSTR-1 JSON
   + Purchase / Sales Register XLSX, run through the same code paths the
   Trigger.dev task uses. Demonstrates that the engine produces the
   shape the UI expects on a fixture exercising every exception kind. */

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseGstr2bJson, parseGstr2aJson, parseGstr1Json, looksLikeJson } from "./parse-gst-json";
import { parsePurchaseRegister, parseSalesRegister, mergeInvoices } from "./parse-register";
import { reconcileGst } from "./match";

function bufJson(o: unknown): Buffer {
  return Buffer.from(JSON.stringify(o), "utf8");
}

function bufXlsx(headers: string[], rows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

describe("smoke: realistic Apr 2026 reconciliation", () => {
  // ── GSTR-2B JSON — six suppliers, one invoice each ──────────────────
  //   Acme    INV/2026-27/0042  (will match books exact)
  //   Acme    INV/2026-27/0058  (will match books via punctuation-normalisation)
  //   Beta    B-101             (will match books exact)
  //   Beta    B-102             (books has wrong taxable → value-diff)
  //   Gamma   GL-2604           (books has date 8 days off → date-diff)
  //   Delta   DS/501            (books typed Acme's GSTIN for it → gstin-mismatch)
  //   Echo    EC-77             (books doesn't have it → missing-in-books)
  //   (ineligible flag on one row exercises the itcEligible parser)
  const gstr2b = {
    data: {
      rtnprd: "042026",
      gstin: "29MYGSTIN1234A1Z5",
      docdata: {
        b2b: [
          {
            ctin: "29ACMEM0001A1Z9", trdnm: "Acme Manufacturing Pvt Ltd", supfildt: "11-05-2026",
            inv: [
              { inum: "INV/2026-27/0042", dt: "01-04-2026", val: 118000, txval: 100000, iamt: 0, camt: 9000, samt: 9000, csamt: 0, itcavl: "Y", rsn: "" },
              { inum: "INV/2026-27/0058", dt: "18-04-2026", val: 11800, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0, itcavl: "Y", rsn: "" },
            ],
          },
          {
            ctin: "29BETAB0002B1Z8", trdnm: "Beta Traders", supfildt: "12-05-2026",
            inv: [
              { inum: "B-101", dt: "05-04-2026", val: 47200, txval: 40000, iamt: 7200, camt: 0, samt: 0, csamt: 0, itcavl: "Y", rsn: "" },
              { inum: "B-102", dt: "06-04-2026", val: 59000, txval: 50000, iamt: 9000, camt: 0, samt: 0, csamt: 0, itcavl: "Y", rsn: "" },
            ],
          },
          {
            ctin: "29GAMMA0003G1Z7", trdnm: "Gamma Logistics", supfildt: "13-05-2026",
            inv: [
              { inum: "GL-2604", dt: "10-04-2026", val: 5900, txval: 5000, iamt: 0, camt: 450, samt: 450, csamt: 0, itcavl: "N", rsn: "POS rule overruled" },
            ],
          },
          {
            ctin: "29DELTA0004D1Z6", trdnm: "Delta Stationery", supfildt: "12-05-2026",
            inv: [
              { inum: "DS/501", dt: "25-04-2026", val: 2360, txval: 2000, iamt: 0, camt: 180, samt: 180, csamt: 0, itcavl: "Y", rsn: "" },
            ],
          },
          {
            ctin: "29ECHOE0005E1Z5", trdnm: "Echo Tools", supfildt: "12-05-2026",
            inv: [
              { inum: "EC-77", dt: "22-04-2026", val: 8260, txval: 7000, iamt: 0, camt: 630, samt: 630, csamt: 0, itcavl: "Y", rsn: "" },
            ],
          },
        ],
      },
    },
  };

  // GSTR-2A — same as 2B PLUS Acme's INV/2026-27/0073 which the supplier
  // filed after the 2B cutoff. The supplier-rollup tab will show this as
  // "filed late" for Acme.
  const gstr2a = {
    b2b: [
      {
        ctin: "29ACMEM0001A1Z9",
        inv: [
          { inum: "INV/2026-27/0042", idt: "01-04-2026", val: 118000, txval: 100000, iamt: 0, camt: 9000, samt: 9000, csamt: 0 },
          { inum: "INV/2026-27/0058", idt: "18-04-2026", val: 11800, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 },
          { inum: "INV/2026-27/0073", idt: "29-04-2026", val: 23600, txval: 20000, iamt: 0, camt: 1800, samt: 1800, csamt: 0 },
        ],
      },
      { ctin: "29BETAB0002B1Z8", inv: [
        { inum: "B-101", idt: "05-04-2026", val: 47200, txval: 40000, iamt: 7200, camt: 0, samt: 0, csamt: 0 },
        { inum: "B-102", idt: "06-04-2026", val: 59000, txval: 50000, iamt: 9000, camt: 0, samt: 0, csamt: 0 },
      ]},
      { ctin: "29GAMMA0003G1Z7", inv: [{ inum: "GL-2604", idt: "10-04-2026", val: 5900, txval: 5000, iamt: 0, camt: 450, samt: 450, csamt: 0 }] },
      { ctin: "29DELTA0004D1Z6", inv: [{ inum: "DS/501", idt: "25-04-2026", val: 2360, txval: 2000, iamt: 0, camt: 180, samt: 180, csamt: 0 }] },
      { ctin: "29ECHOE0005E1Z5", inv: [{ inum: "EC-77", idt: "22-04-2026", val: 8260, txval: 7000, iamt: 0, camt: 630, samt: 630, csamt: 0 }] },
    ],
  };

  // Purchase Register — one row per exception kind, no overlaps.
  //   row 1  Acme 0042                 → matches exact
  //   row 2  Acme "INV-2026-27-0058"   → matches (invoice-no normalised)
  //   row 3  Beta B-101                → matches exact
  //   row 4  Beta B-102 with 50500     → value-diff (books taxable 50500 vs 2B 50000)
  //   row 5  Gamma GL-2604 dated 18/04 → date-diff (8d gap > 7d window)
  //   row 6  Epsilon INV-EPS-001       → missing-in-2b (no 2B row at all)
  //   row 7  Acme 0073                 → missing-in-2b (in 2A but past 2B cutoff)
  //   row 8  Acme "DS/501" *typo*      → gstin-mismatch (Delta's DS/501 in 2B)
  //
  //   Plus Echo EC-77 in 2B with no books row → missing-in-books exception.
  const purchaseRegister = bufXlsx(
    ["Supplier GSTIN", "Supplier Name", "Invoice No", "Invoice Date", "Taxable Value", "IGST", "CGST", "SGST", "Invoice Value"],
    [
      ["29ACMEM0001A1Z9", "Acme Manufacturing", "INV/2026-27/0042", "01/04/2026", 100000, 0, 9000, 9000, 118000],
      ["29ACMEM0001A1Z9", "Acme Manufacturing", "INV-2026-27-0058", "18/04/2026", 10000, 0, 900, 900, 11800],
      ["29BETAB0002B1Z8", "Beta Traders", "B-101", "05/04/2026", 40000, 7200, 0, 0, 47200],
      ["29BETAB0002B1Z8", "Beta Traders", "B-102", "06/04/2026", 50500, 9000, 0, 0, 59500],
      ["29GAMMA0003G1Z7", "Gamma Logistics", "GL-2604", "18/04/2026", 5000, 0, 450, 450, 5900],
      ["29EPSIL0006E1Z4", "Epsilon Stationery", "INV-EPS-001", "20/04/2026", 3000, 0, 270, 270, 3540],
      ["29ACMEM0001A1Z9", "Acme Manufacturing", "INV/2026-27/0073", "29/04/2026", 20000, 0, 1800, 1800, 23600],
      ["29ACMEM0001A1Z9", "Acme Manufacturing", "DS/501", "25/04/2026", 2000, 0, 180, 180, 2360],
    ],
  );

  // GSTR-1 (outward) + Sales Register — one happy match + one short-filing.
  const gstr1 = {
    gstin: "29MYGSTIN1234A1Z5",
    fp: "042026",
    b2b: [
      {
        ctin: "29CUSTA0007C1Z3",
        inv: [
          {
            inum: "S-001", idt: "02-04-2026", val: 11800,
            itms: [{ num: 1, itm_det: { txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 } }],
          },
        ],
      },
    ],
  };
  const salesRegister = bufXlsx(
    ["Customer GSTIN", "Customer Name", "Invoice No", "Invoice Date", "Taxable Value", "IGST", "CGST", "SGST"],
    [
      ["29CUSTA0007C1Z3", "Customer A", "S-001", "02/04/2026", 10000, 0, 900, 900],
      ["29CUSTB0008C1Z2", "Customer B", "S-002", "15/04/2026", 25000, 4500, 0, 0],
    ],
  );

  it("dispatches each input to the right parser, matches, and produces the result shape the UI consumes", () => {
    // ── Sanity: parser auto-detection ────────────────────────────────
    expect(looksLikeJson(bufJson(gstr2b))).toBe(true);
    expect(looksLikeJson(purchaseRegister)).toBe(false);

    // ── Parse like jobs/reconcile.ts does ────────────────────────────
    const twoB = parseGstr2bJson(bufJson(gstr2b), "2b-apr.json");
    const twoA = parseGstr2aJson(bufJson(gstr2a), "2a-apr.json");
    const g1 = parseGstr1Json(bufJson(gstr1), "1-apr.json");
    const purchase = parsePurchaseRegister(purchaseRegister, "purchase-apr.xlsx");
    const sales = parseSalesRegister(salesRegister, "sales-apr.xlsx");

    expect(twoB.invoices).toHaveLength(7);    // Acme×2 + Beta×2 + Gamma + Delta + Echo
    expect(twoA.invoices).toHaveLength(8);    // Acme×3 + Beta×2 + Gamma + Delta + Echo
    expect(g1.invoices).toHaveLength(1);
    expect(purchase.invoices).toHaveLength(8);
    expect(sales.invoices).toHaveLength(2);

    // GSTR-2B should set itcEligible correctly.
    const ineligible = twoB.invoices.filter((i) => i.itcEligible === false);
    expect(ineligible).toHaveLength(1);
    expect(ineligible[0].invoiceNo).toBe("GL-2604");
    expect(ineligible[0].itcReason).toBe("POS rule overruled");

    // ── Merge per side (single-file path — same logic as multi-file) ──
    const purchaseMerge = mergeInvoices([{ file: "purchase-apr.xlsx", invoices: purchase.invoices }]);
    const twoBMerge = mergeInvoices([{ file: "2b-apr.json", invoices: twoB.invoices }]);

    // ── Run the matcher ──────────────────────────────────────────────
    const r = reconcileGst({
      gstr1: g1.invoices,
      gstr2a: twoA.invoices,
      gstr2b: twoBMerge.merged,
      sales: sales.invoices,
      purchase: purchaseMerge.merged,
    });

    // ── ITC pass: 3 matches (Acme 0042 + Acme 0058 + Beta B-101) ─────
    expect(r.itcMatches).toHaveLength(3);
    const matchedInvoices = r.itcMatches.map((m) => m.books.invoiceNo).sort();
    expect(matchedInvoices).toEqual(["B-101", "INV-2026-27-0058", "INV/2026-27/0042"]);
    expect(r.itcMatches.find((m) => m.books.invoiceNo === "INV-2026-27-0058")?.warnings[0]).toMatch(/normalised/);

    // ── ITC pass: 6 exceptions, one per kind we designed for ─────────
    const kinds = r.itcExceptions.map((e) => e.kind).sort();
    expect(kinds).toEqual([
      "date-diff",        // Gamma GL-2604
      "gstin-mismatch",   // Acme/DS-501 (Delta's invoice typed against Acme's GSTIN)
      "missing-in-2b",    // Epsilon (no 2B at all)
      "missing-in-2b",    // Acme 0073 (filed late, only in 2A)
      "missing-in-books", // Echo EC-77 (2B has, books doesn't)
      "value-diff",       // Beta B-102 (₹500 taxable diff)
    ]);

    // ── Sort: most urgent at the top of the table ────────────────────
    expect(r.itcExceptions[0].kind).toBe("missing-in-2b");
    expect(r.itcExceptions.at(-1)?.kind).toBe("date-diff");

    // ── Money math is real (not NaN/undefined) ───────────────────────
    expect(r.summary.itcTaxAtRisk).toBeGreaterThan(0);
    expect(r.summary.itcTaxMatched).toBeGreaterThan(0);
    // 3 matched: Acme 0042 (₹18,000 tax) + Acme 0058 (₹1,800) + Beta B-101 (₹7,200) = ₹27,000.
    expect(r.summary.itcTaxMatched).toBe(27000);

    // ── Sales pass: 1 match + 1 missing-in-gstr1 ─────────────────────
    expect(r.salesMatches).toHaveLength(1);
    expect(r.salesExceptions).toHaveLength(1);
    expect(r.salesExceptions[0].kind).toBe("missing-in-gstr1");
    expect(r.salesExceptions[0].taxAtRisk).toBe(4500);

    // ── Supplier rollup: Acme's 0073 is the "filed late" case ────────
    const acme = r.supplierRollup.find((s) => s.gstin === "29ACMEM0001A1Z9");
    expect(acme).toBeDefined();
    expect(acme!.filedLateInvoiceCount).toBe(1);
    expect(acme!.filedLateTaxAmount).toBe(3600);
    // Books: 0042+0058+0073+DS501 (4 rows). 2B has 0042+0058 (2 rows).
    expect(acme!.booksInvoiceCount).toBe(4);
    expect(acme!.twoBInvoiceCount).toBe(2);

    // ── UI consumes summary.itcExceptionsByKind directly ─────────────
    expect(r.summary.itcExceptionsByKind["missing-in-2b"]).toBe(2);
    expect(r.summary.itcExceptionsByKind["gstin-mismatch"]).toBe(1);
    expect(r.summary.itcExceptionsByKind["value-diff"]).toBe(1);
    expect(r.summary.itcExceptionsByKind["date-diff"]).toBe(1);
    expect(r.summary.itcExceptionsByKind["missing-in-books"]).toBe(1);
    expect(r.summary.salesExceptionsByKind["missing-in-gstr1"]).toBe(1);

    // Notes empty on the happy path.
    expect(twoB.notes).toEqual([]);
    expect(twoA.notes).toEqual([]);
    expect(g1.notes).toEqual([]);
  });
});
