import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseRecipients } from "./parse";

function csvBuffer(rows: string[][]): Buffer {
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const text = rows.map((r) => r.map(escape).join(",")).join("\n");
  return Buffer.from(text, "utf8");
}

function xlsxBuffer(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const EMPTY = { currency: "", amount: "", balance: "", invoiceNumber: "", invoiceDetails: "", dueDate: "" };

describe("parseRecipients", () => {
  it("parses a simple CSV with Email + Name", () => {
    const buf = csvBuffer([
      ["Email", "Name"],
      ["asha@example.com", "Asha"],
      ["rao@example.com", "Rao"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([
      { email: "asha@example.com", name: "Asha", ...EMPTY },
      { email: "rao@example.com", name: "Rao", ...EMPTY },
    ]);
    expect(r.dropped).toBe(0);
    expect(r.totalRows).toBe(2);
  });

  it("captures all the payment columns in any order", () => {
    const buf = csvBuffer([
      ["Invoice No", "Customer", "Currency", "Amount Due", "Balance", "Due Date", "Email", "Particulars"],
      ["INV-118", "Asha", "INR", "12000", "45000", "15-06-2026", "asha@example.com", "Consulting"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([
      {
        email: "asha@example.com",
        name: "Asha",
        currency: "INR",
        amount: "12000",
        balance: "45000",
        invoiceNumber: "INV-118",
        invoiceDetails: "Consulting",
        dueDate: "15-06-2026",
      },
    ]);
  });

  it("works when only an email column is present", () => {
    const buf = csvBuffer([["Email"], ["asha@example.com"]]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([
      { email: "asha@example.com", name: "", ...EMPTY },
    ]);
  });

  it("keeps invoice number and invoice details distinct", () => {
    const buf = csvBuffer([
      ["Email", "Invoice Number", "Invoice Details"],
      ["asha@example.com", "INV-9", "Retainer fee"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients[0].invoiceNumber).toBe("INV-9");
    expect(r.recipients[0].invoiceDetails).toBe("Retainer fee");
  });

  it("drops blank rows and invalid emails", () => {
    const buf = csvBuffer([
      ["Email", "Name"],
      ["asha@example.com", "Asha"],
      ["", ""],
      ["not-an-email", "Bogus"],
      ["rao@example.com", "Rao"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients.map((x) => x.email)).toEqual([
      "asha@example.com",
      "rao@example.com",
    ]);
    expect(r.dropped).toBe(1);
    expect(r.totalRows).toBe(3);
  });

  it("lower-cases emails and trims whitespace", () => {
    const buf = csvBuffer([
      ["Email", "Name"],
      ["  Asha@Example.COM  ", "  Asha  "],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([
      { email: "asha@example.com", name: "Asha", ...EMPTY },
    ]);
  });

  it("throws a helpful error when no email column is found", () => {
    const buf = csvBuffer([
      ["Customer", "Phone"],
      ["Asha", "9999999999"],
    ]);
    expect(() => parseRecipients(buf)).toThrow(/email column/i);
  });

  it("parses XLSX the same way as CSV", () => {
    const buf = xlsxBuffer([
      ["Email", "Name", "Currency", "Amount Due"],
      ["asha@example.com", "Asha", "USD", "12000"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([
      { email: "asha@example.com", name: "Asha", currency: "USD", amount: "12000", balance: "", invoiceNumber: "", invoiceDetails: "", dueDate: "" },
    ]);
  });
});
