import { describe, it, expect } from "vitest";
import { parseAddressList } from "../email-addr";

describe("parseAddressList", () => {
  it("returns [] for empty / null / undefined", () => {
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList("   ")).toEqual([]);
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });

  it("splits a comma-separated list and trims + lower-cases", () => {
    expect(parseAddressList("Asha@Example.com, Ravi@Example.com")).toEqual([
      "asha@example.com",
      "ravi@example.com",
    ]);
  });

  it("also splits on semicolons", () => {
    expect(parseAddressList("a@x.com; b@x.com,c@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });

  it("drops blanks and invalid addresses", () => {
    expect(parseAddressList("good@x.com, , not-an-email, also bad")).toEqual([
      "good@x.com",
    ]);
  });

  it("de-duplicates (case-insensitively)", () => {
    expect(parseAddressList("dup@x.com, DUP@x.com, dup@x.com")).toEqual([
      "dup@x.com",
    ]);
  });
});
