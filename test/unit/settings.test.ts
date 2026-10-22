import { describe, expect, it } from "vitest";
import {
  clamp,
  newId,
  normalizeOrcid,
  parseAuthors,
  parseJournalBonus,
  parseJournals,
  parseRules,
  queryError,
} from "../../src/core/settings";

describe("normalizeOrcid", () => {
  it("accepts valid iDs, with or without URL, including X check digits", () => {
    expect(normalizeOrcid("https://orcid.org/0000-0002-3933-920X")).toBe(
      "0000-0002-3933-920X",
    );
    expect(normalizeOrcid("0000000293338449")).toBeNull(); // bad check digit
    expect(normalizeOrcid("0000-0002-1825-0097")).toBe("0000-0002-1825-0097"); // ORCID's documented example
  });

  it("rejects garbage", () => {
    expect(normalizeOrcid("")).toBeNull();
    expect(normalizeOrcid("Chandler")).toBeNull();
  });
});

describe("parseJournals", () => {
  it("keeps valid journals and explains skipped ones", () => {
    const raw = JSON.stringify([
      {
        title: "Business History",
        issnPrint: "0007-6791",
        issnElectronic: "1743-7938",
        source: "search",
      },
      { title: "Bad ISSN only", issnPrint: "0007-6792" },
      { issnPrint: "0143-2095" },
      { title: "Feed only", feedUrl: "https://example.org/rss" },
      { title: "Bad URL", feedUrl: "ftp://x" },
    ]);
    const { value, warnings } = parseJournals(raw);
    expect(value.map((j) => j.title)).toEqual([
      "Business History",
      "Feed only",
    ]);
    expect(value[0]).toMatchObject({
      id: "0007-6791",
      crossref: true,
      source: "search",
    });
    expect(value[1]).toMatchObject({
      id: "feed:https://example.org/rss",
      crossref: false,
      source: "manual",
    });
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/Bad ISSN only/);
  });

  it("survives corrupted or missing prefs", () => {
    expect(parseJournals(undefined)).toEqual({ value: [], warnings: [] });
    expect(parseJournals("{not json").warnings).toHaveLength(1);
    expect(parseJournals('{"a":1}').warnings).toHaveLength(1);
  });
});

describe("parseRules / queryError", () => {
  it("clamps weights and keeps flags", () => {
    const { value } = parseRules(
      JSON.stringify([
        { id: "r1", query: "histor*", weight: 1000 },
        { id: "r2", query: "financ*", weight: "x", exclude: true },
        { query: "  " },
      ]),
    );
    expect(value).toEqual([
      {
        id: "r1",
        label: undefined,
        query: "histor*",
        weight: 100,
        exclude: undefined,
        enabled: undefined,
      },
      {
        id: "r2",
        label: undefined,
        query: "financ*",
        weight: 1,
        exclude: true,
        enabled: undefined,
      },
    ]);
  });

  it("reports query syntax errors for live feedback", () => {
    expect(queryError('"organizational decline" OR histor*')).toBeNull();
    expect(queryError("(decline")).toBe("A parenthesis is not closed.");
  });
});

describe("parseAuthors", () => {
  it("validates ORCIDs and defaults the weight", () => {
    const { value, warnings } = parseAuthors(
      JSON.stringify([
        {
          family: "Iorio",
          given: "Alessandro",
          orcid: "https://orcid.org/0000-0002-3933-920X",
        },
        { family: "Chandler", orcid: "1234" },
        { given: "No family" },
      ]),
    );
    expect(value).toEqual([
      {
        id: "author-1",
        family: "Iorio",
        given: "Alessandro",
        orcid: "0000-0002-3933-920X",
        weight: 5,
      },
    ]);
    expect(warnings).toEqual([
      'Chandler: "1234" is not a valid ORCID iD.',
      "Author 3 has no family name and was skipped.",
    ]);
  });
});

describe("helpers", () => {
  it("parseJournalBonus ignores junk", () => {
    expect(parseJournalBonus('{"0143-2095": 2, "x": "y"}')).toEqual({
      "0143-2095": 2,
    });
    expect(parseJournalBonus("[]")).toEqual({});
    expect(parseJournalBonus("nope")).toEqual({});
  });

  it("clamp rounds and bounds", () => {
    expect(clamp("7.6", [1, 10], 3)).toBe(8);
    expect(clamp(-5, [1, 10], 3)).toBe(1);
    expect(clamp(undefined, [1, 10], 3)).toBe(3);
  });

  it("newId avoids collisions", () => {
    expect(newId("rule", [{ id: "rule-2" }, { id: "rule-3" }])).toBe("rule-4");
  });
});
