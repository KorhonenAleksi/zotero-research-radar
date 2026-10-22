import { describe, expect, it } from "vitest";
import { ft50Info, ft50Journals } from "../../src/core/catalogue";
import { isValidIssn } from "../../src/core/issn";

describe("FT50 catalogue", () => {
  const journals = ft50Journals();

  it("has exactly 50 journals from the 2026 edition", () => {
    expect(journals).toHaveLength(50);
    expect(ft50Info.edition).toBe("2026");
  });

  it("gives every journal at least one ISSN, all with valid check digits", () => {
    for (const j of journals) {
      const issns = [j.issnPrint, j.issnElectronic].filter(Boolean);
      expect(issns.length, j.title).toBeGreaterThan(0);
      for (const issn of issns)
        expect(isValidIssn(issn), `${j.title} ${issn}`).toBe(true);
    }
  });

  it("has unique ids and titles", () => {
    expect(new Set(journals.map((j) => j.id)).size).toBe(50);
    expect(new Set(journals.map((j) => j.title)).size).toBe(50);
  });

  it("reflects the 2026 revision", () => {
    const titles = journals.map((j) => j.title);
    expect(titles).toContain("Academy of Management Annals");
    expect(titles).toContain("Psychological Science");
    expect(titles).not.toContain("Organization Studies");
    expect(titles).not.toContain("Human Relations");
  });

  it("marks Harvard Business Review as RSS-only", () => {
    const hbr = journals.find((j) => j.title === "Harvard Business Review");
    expect(hbr?.crossref).toBe(false);
    expect(journals.filter((j) => !j.crossref)).toHaveLength(1);
  });
});
