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

  it("replaces every occurrence", () => {
    expect(applyMerge("{{name}} · {{name}} · {{name}}", { name: "x" }))
      .toBe("x · x · x");
  });

  it("renders empty string when name is missing", () => {
    expect(applyMerge("Hi {{name}},", {})).toBe("Hi ,");
    expect(applyMerge("Hi {{name}}", { name: "" })).toBe("Hi ");
    expect(applyMerge("Hi {{name}}", { name: "   " })).toBe("Hi ");
  });

  it("does not touch text outside the token", () => {
    expect(applyMerge("Subject: Welcome {{name}}!", { name: "Asha" }))
      .toBe("Subject: Welcome Asha!");
  });

  it("returns the template unchanged when there is no token", () => {
    expect(applyMerge("Hello there", { name: "Asha" })).toBe("Hello there");
  });
});
