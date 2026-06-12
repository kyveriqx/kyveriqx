import { describe, it, expect } from "vitest";
import { applyMerge } from "./merge";

describe("applyMerge", () => {
  it("replaces a simple {{name}} token", () => {
    expect(applyMerge("Hi {{name}}", { name: "Asha" })).toBe("Hi Asha");
  });

  it("is case-insensitive on the token", () => {
    expect(applyMerge("Hi {{Name}}, hello {{NAME}}", { name: "Rao" }))
      .toBe("Hi Rao, hello Rao");
  });

  it("tolerates inner whitespace", () => {
    expect(applyMerge("Hi {{ name }} and {{  name}}", { name: "K" }))
      .toBe("Hi K and K");
  });

  it("merges every payment field", () => {
    const row = {
      name: "Asha",
      amount: "₹12,000",
      balance: "₹45,000",
      invoiceNumber: "INV-2024-118",
      invoiceDetails: "Consulting — March",
      dueDate: "15-06-2026",
    };
    const tmpl =
      "Dear {{name}}, invoice {{invoice_number}} ({{invoice_details}}) for " +
      "{{amount}} is due by {{due_date}}. Balance: {{balance}}.";
    expect(applyMerge(tmpl, row)).toBe(
      "Dear Asha, invoice INV-2024-118 (Consulting — March) for ₹12,000 is " +
        "due by 15-06-2026. Balance: ₹45,000.",
    );
  });

  it("renders empty string when a known field is missing", () => {
    expect(applyMerge("Balance: {{balance}}.", {})).toBe("Balance: .");
    expect(applyMerge("Amount {{amount}}", { amount: "   " })).toBe("Amount ");
  });

  it("leaves unknown tokens untouched", () => {
    expect(applyMerge("Hi {{name}} {{phone}}", { name: "Asha" }))
      .toBe("Hi Asha {{phone}}");
  });

  it("returns the template unchanged when there is no token", () => {
    expect(applyMerge("Hello there", { name: "Asha" })).toBe("Hello there");
  });
});
