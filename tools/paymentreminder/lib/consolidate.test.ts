import { describe, it, expect } from "vitest";
import {
  groupByEmail,
  parseAmount,
  formatAmount,
  sumAmounts,
  buildInvoiceTableHtml,
  consolidatedExtras,
} from "./consolidate";
import type { Recipient } from "./types";

function row(over: Partial<Recipient>): Recipient {
  return {
    email: "asha@example.com", name: "Asha", currency: "INR",
    amount: "", invoiceNumber: "", invoiceDetails: "", dueDate: "",
    ...over,
  };
}

describe("parseAmount", () => {
  it("strips commas and whitespace", () => {
    expect(parseAmount("12,000")).toBe(12000);
    expect(parseAmount("  8500 ")).toBe(8500);
    expect(parseAmount("1,200.50")).toBe(1200.5);
  });
  it("returns null for non-numeric / empty", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
    expect(parseAmount("-")).toBeNull();
  });
});

describe("formatAmount", () => {
  it("groups thousands and trims .00", () => {
    expect(formatAmount(50500)).toBe("50,500");
    expect(formatAmount(1200.5)).toBe("1,200.50");
    expect(formatAmount(0)).toBe("0");
  });
});

describe("groupByEmail", () => {
  it("groups rows sharing an email, preserving first-seen order", () => {
    const rows = [
      row({ email: "a@x.com", invoiceNumber: "1" }),
      row({ email: "b@x.com", invoiceNumber: "2" }),
      row({ email: "A@X.com", invoiceNumber: "3" }), // same as a@x.com (case-insensitive)
    ];
    const groups = groupByEmail(rows);
    expect(groups.length).toBe(2);
    expect(groups[0].map((r) => r.invoiceNumber)).toEqual(["1", "3"]);
    expect(groups[1].map((r) => r.invoiceNumber)).toEqual(["2"]);
  });
});

describe("sumAmounts", () => {
  it("sums parseable amounts and skips the rest", () => {
    const rows = [row({ amount: "12,000" }), row({ amount: "8,500" }), row({ amount: "N/A" })];
    expect(sumAmounts(rows)).toBe(20500);
  });
});

describe("buildInvoiceTableHtml", () => {
  const rows = [
    row({ invoiceNumber: "INV-118", invoiceDetails: "Consulting", dueDate: "20-06-2026", amount: "12,000" }),
    row({ invoiceNumber: "INV-121", invoiceDetails: "Maintenance", dueDate: "22-06-2026", amount: "8,500" }),
  ];
  const html = buildInvoiceTableHtml(rows);

  it("lists every invoice", () => {
    expect(html).toContain("INV-118");
    expect(html).toContain("INV-121");
    expect(html).toContain("Consulting");
  });
  it("shows the summed total with the currency code", () => {
    expect(html).toContain("Total (INR)");
    expect(html).toContain("20,500");
  });
  it("escapes HTML in cell values", () => {
    const evil = buildInvoiceTableHtml([row({ invoiceDetails: "<script>x</script>", amount: "1" })]);
    expect(evil).not.toContain("<script>x</script>");
    expect(evil).toContain("&lt;script&gt;");
  });
});

describe("consolidatedExtras", () => {
  it("returns total, count and an invoice table", () => {
    const rows = [row({ amount: "12,000", invoiceNumber: "INV-1" }), row({ amount: "8,500", invoiceNumber: "INV-2" })];
    const extra = consolidatedExtras(rows);
    expect(extra.total).toBe("20,500");
    expect(extra.count).toBe("2");
    expect(extra.invoice_table).toContain("INV-1");
    expect(extra.invoice_table).toContain("INV-2");
  });
});
