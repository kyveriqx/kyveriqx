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

describe("parseRecipients", () => {
  it("parses a simple CSV with Email + Name", () => {
    const buf = csvBuffer([
      ["Email", "Name"],
      ["asha@example.com", "Asha"],
      ["rao@example.com", "Rao"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([
      { email: "asha@example.com", name: "Asha" },
      { email: "rao@example.com", name: "Rao" },
    ]);
    expect(r.dropped).toBe(0);
    expect(r.totalRows).toBe(2);
  });

  it("auto-detects column order (Name before Email)", () => {
    const buf = csvBuffer([
      ["Name", "Email"],
      ["Asha", "asha@example.com"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([{ email: "asha@example.com", name: "Asha" }]);
  });

  it("matches alternate header labels (E-mail, Full Name)", () => {
    const buf = csvBuffer([
      ["Full Name", "E-mail"],
      ["Asha Patel", "asha@example.com"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([
      { email: "asha@example.com", name: "Asha Patel" },
    ]);
  });

  it("works when the name column is missing", () => {
    const buf = csvBuffer([
      ["Email"],
      ["asha@example.com"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([{ email: "asha@example.com", name: "" }]);
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
    expect(r.recipients).toEqual([{ email: "asha@example.com", name: "Asha" }]);
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
      ["Email", "Name"],
      ["asha@example.com", "Asha"],
      ["rao@example.com", "Rao"],
    ]);
    const r = parseRecipients(buf);
    expect(r.recipients).toEqual([
      { email: "asha@example.com", name: "Asha" },
      { email: "rao@example.com", name: "Rao" },
    ]);
  });
});
