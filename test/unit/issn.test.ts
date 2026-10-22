import { describe, expect, it } from "vitest";
import { isValidIssn, normalizeIssn } from "../../src/core/issn";

describe("normalizeIssn", () => {
  it("formats compact and spaced input", () => {
    expect(normalizeIssn("01432095")).toBe("0143-2095");
    expect(normalizeIssn(" 0143 2095 ")).toBe("0143-2095");
    expect(normalizeIssn("1099-050x")).toBe("1099-050X");
  });

  it("rejects things that are not ISSNs", () => {
    expect(normalizeIssn("")).toBeNull();
    expect(normalizeIssn(null)).toBeNull();
    expect(normalizeIssn("0143-209")).toBeNull();
    expect(normalizeIssn("10.1002/smj.70136")).toBeNull();
  });
});

describe("isValidIssn", () => {
  it("accepts correct check digits, including X", () => {
    expect(isValidIssn("0143-2095")).toBe(true); // Strategic Management Journal
    expect(isValidIssn("1099-050X")).toBe(true); // Human Resource Management (e)
    expect(isValidIssn("0304-405X")).toBe(true); // Journal of Financial Economics
  });

  it("rejects a mistyped digit", () => {
    expect(isValidIssn("0143-2096")).toBe(false);
    expect(isValidIssn("0134-2095")).toBe(false);
  });
});
