import { describe, expect, it } from "vitest";
import {
  buildJournalSearchUrl,
  normalizeTitle,
  parseJournalSearch,
} from "../../src/core/journalSearch";
import fixture from "./fixtures/crossref-journals-journal-of-management.json";

describe("buildJournalSearchUrl", () => {
  it("encodes the query and adds mailto only when given", () => {
    expect(buildJournalSearchUrl(" Business & Society ")).toBe(
      "https://api.crossref.org/journals?query=Business+%26+Society&rows=20",
    );
    expect(
      buildJournalSearchUrl("x", { rows: 5, mailto: "me@example.org" }),
    ).toContain("rows=5&mailto=me%40example.org");
  });
});

describe("normalizeTitle", () => {
  it("treats The, & and punctuation as equal", () => {
    expect(normalizeTitle("The Journal of Finance")).toBe(
      normalizeTitle("Journal of Finance"),
    );
    expect(
      normalizeTitle("Manufacturing & Service Operations Management"),
    ).toBe(normalizeTitle("Manufacturing and Service Operations Management"));
    expect(normalizeTitle("Accounting, Organizations and Society")).toBe(
      normalizeTitle("Accounting Organizations and Society"),
    );
  });
});

describe("parseJournalSearch (real Crossref response for 'journal of management')", () => {
  const results = parseJournalSearch(fixture, "Journal of Management");

  it("puts the SAGE Journal of Management first, ahead of namesakes", () => {
    expect(results[0]).toMatchObject({
      title: "Journal of Management",
      publisher: "SAGE Publications",
      issnPrint: "0149-2063",
      issnElectronic: "1557-1211",
      exactTitle: true,
    });
  });

  it("lists all exact-title namesakes before partial matches", () => {
    const exact = results.filter((r) => r.exactTitle);
    expect(exact.length).toBe(5);
    expect(results.slice(0, 5).every((r) => r.exactTitle)).toBe(true);
  });

  it("keeps partial matches, ordered by recent activity", () => {
    const partial = results.filter((r) => !r.exactTitle);
    expect(partial.length).toBeGreaterThan(0);
    for (let i = 1; i < partial.length; i++)
      expect(partial[i - 1].currentDois).toBeGreaterThanOrEqual(
        partial[i].currentDois,
      );
  });

  it("returns nothing for an empty or malformed response", () => {
    expect(parseJournalSearch({}, "x")).toEqual([]);
    expect(parseJournalSearch(null, "x")).toEqual([]);
  });
});

describe("parseJournalSearch ISSN hygiene", () => {
  it("skips a mistyped ISSN and uses a valid untyped one instead", () => {
    // Shape of Crossref's real record for Entrepreneurship Theory and Practice
    const response = {
      message: {
        items: [
          {
            title: "Entrepreneurship Theory and Practice",
            publisher: "SAGE Publications",
            "issn-type": [
              { type: "print", value: "1042-2587" },
              { type: "electronic", value: "1540-8520" },
              { type: null, value: "1540-6520" },
            ],
            counts: { "current-dois": 158, "total-dois": 3000 },
          },
        ],
      },
    };
    const [etp] = parseJournalSearch(
      response,
      "Entrepreneurship Theory and Practice",
    );
    expect(etp.issnPrint).toBe("1042-2587");
    expect(etp.issnElectronic).toBe("1540-6520");
  });

  it("drops a journal whose only ISSN is invalid", () => {
    const response = {
      message: {
        items: [
          {
            title: "Bad",
            "issn-type": [{ type: "print", value: "0143-2096" }],
          },
        ],
      },
    };
    expect(parseJournalSearch(response, "Bad")).toEqual([]);
  });
});

describe("parseJournalSearch decodes escaped names", () => {
  it("turns &amp; into &", () => {
    const [r] = parseJournalSearch(
      {
        message: {
          items: [
            {
              title: "Enterprise &amp; Society",
              publisher: "Cambridge University Press (CUP)",
              "issn-type": [{ type: "print", value: "1467-2227" }],
            },
          ],
        },
      },
      "Enterprise & Society",
    );
    expect(r.title).toBe("Enterprise & Society");
    expect(r.exactTitle).toBe(true);
  });
});
