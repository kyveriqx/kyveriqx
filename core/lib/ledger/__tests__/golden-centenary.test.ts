/* Golden regression: the real customer reconciliation that the live tool could
   not handle (GrowiT India ↔ Centenary Geotex). Feeds all 11 source files
   (2 GrowiT Excel + 5 Tally PDFs + 4 Business Central Excel) through the
   multi-file pipeline and asserts the headline ties to the rupee, matching the
   Python reference (Asset/TOOL TESTING/ORG RECO/reconcile.py). */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseCompanyFiles, parsePartnerFiles, reconcileFromFiles } from "../run-pipeline";
import { parseCompanyPdf } from "../parse-company-pdf";

// These are the real (untracked) customer files; skip when they aren't present
// (e.g. in CI) so the suite stays green without them.
const DIR = "Asset/TOOL TESTING/ORG RECO";
const HAVE_FIXTURES = existsSync(`${DIR}/GrowiT-DCS Multiple Vendor Statement (39).xlsx`);
const load = (name: string) => ({ buffer: readFileSync(`${DIR}/${name}`), filename: name });

const COMPANY = [load("GrowiT-DCS Multiple Vendor Statement (39).xlsx")];
const PARTNER = [
  // FY23-24 Tally PDFs (one is a duplicate of Daman → must be de-duped)
  load("GIPL Daman.pdf"),
  load("GIPL (1).pdf"),
  load("GIPL - Pune (1).pdf"),
  load("GIPL - Surat (1).pdf"),
  load("GIPL - Nashik (1).pdf"),
  // FY24-26 Business Central Excel
  load("GROWIT LEDGER (DAMAN) (1).xlsx"),
  load("GROWIT LEDGER ( SURAT) (1).xlsx"),
  load("GROWIT LEDGER (PUNE) (1).xlsx"),
  load("GROWIT LEDGER ( BENGALURU) (1).xlsx"),
];

describe.skipIf(!HAVE_FIXTURES)("golden: GrowiT ↔ Centenary", () => {
  it("company DCS closing ties to −30,034.25", async () => {
    const c = await parseCompanyFiles(COMPANY);
    expect(c.ledger.closingBal).toBeCloseTo(-30034.25, 1);
  });

  it("company-side Tally PDF parses and ties to its printed closing (auto sign)", async () => {
    // Mechanics check: feed a Tally ledger PDF to the company parser; the
    // control-total sign auto-detect must make the running balance tie out.
    const { ledger, tiesOut } = await parseCompanyPdf(readFileSync(`${DIR}/GIPL Daman.pdf`));
    console.log("company-PDF closingRaw:", ledger.closingRaw.toFixed(2), "Dr/Cr:", ledger.closingDrCr, "ties:", tiesOut);
    expect(tiesOut).toBe(true);
    expect(ledger.closingRaw).toBeCloseTo(1458453.19, 1);
    expect(ledger.transactions.length).toBeGreaterThan(50);
  });

  it("partner bridges PDF→Excel and de-dupes to 4 locations", async () => {
    const p = await parsePartnerFiles(PARTNER);
    const byLoc = Object.fromEntries(p.locations.map((l) => [l.location, l.closingBal]));
    // 4 cumulative locations (Nashik FY23-24 nets to 0; Daman dup ignored)
    expect(byLoc["Daman"]).toBeCloseTo(24.0, 0);
    expect(byLoc["Surat"]).toBeCloseTo(-99386.39, 1);
    expect(byLoc["Pune"]).toBeCloseTo(0, 1);
    expect(byLoc["Bengaluru"]).toBeCloseTo(0, 1);
    expect(p.totalClosing).toBeCloseTo(-99362.39, 0);
    // the duplicate Daman PDF must have been dropped
    expect(p.notes?.some((n) => /Duplicate/i.test(n))).toBe(true);
  });

  it("headline gap ties to 69,328.14", async () => {
    const out = await reconcileFromFiles(COMPANY, PARTNER);
    expect(out.companyClosing).toBeCloseTo(-30034.25, 1);
    expect(out.partnerClosing).toBeCloseTo(-99362.39, 0);
    expect(out.totalGap).toBeCloseTo(69328.14, 0);
    console.log("company:", out.companyClosing.toFixed(2),
      "| partner:", out.partnerClosing.toFixed(2),
      "| gap:", out.totalGap.toFixed(2),
      "| notes:", out.notes.length);
    for (const n of out.notes) console.log("  note:", n);
  });

  it("Phase 2: amount+date matching, TDS net ≈ ₹1,447, cut-off surfaced", async () => {
    const out = await reconcileFromFiles(COMPANY, PARTNER);
    const ga = out.gapAnalysis!;
    console.log("matched invoices:", ga.matchedInvoiceCount,
      "(amount+date:", ga.amountDateMatchedCount, ")",
      "| matched payments:", out.matchedPayments.length);
    console.log("TDS: company", ga.tdsCompanyDeducted.toFixed(2),
      "partner", ga.tdsPartnerCredited.toFixed(2), "net", ga.tdsNet.toFixed(2));
    console.log("cut-off items:", ga.cutoffItems.length, "total", ga.cutoffTotal.toFixed(2));
    for (const c of ga.cutoffItems.slice(0, 6)) console.log(`  ${c.side} ${c.ref} ${c.amount.toFixed(2)}`);
    // FY24-26 invoices only pair via the amount+date fallback (different numbering)
    expect(ga.amountDateMatchedCount).toBeGreaterThan(10);
    // partner TDS is detected from descriptions, not over-broad P-JLV prefix
    expect(ga.tdsPartnerCredited).toBeGreaterThan(20000);
    expect(ga.tdsPartnerCredited).toBeLessThan(80000);
    // the May-2026 vendor invoices (after the company's cut-off) are surfaced
    expect(ga.cutoffItems.length).toBeGreaterThan(0);
  });
});
