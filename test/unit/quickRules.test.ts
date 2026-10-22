import { describe, expect, it } from "vitest";
import { parseQuery } from "../../src/core/query";
import {
  authorName,
  isWatched,
  labelFromQuery,
  suggestRuleQuery,
} from "../../src/core/quickRules";

describe("suggestRuleQuery", () => {
  it("turns topic words in a real title into OR-ed phrases", () => {
    expect(
      suggestRuleQuery(
        "Civilising business: The imperial episteme of early US business schools",
      ),
    ).toBe(
      '"civilising business" OR "imperial episteme" OR "business schools"',
    );
  });

  it("keeps a long single topic word and skips filler", () => {
    expect(suggestRuleQuery("Ecosystem governance for circularity")).toBe(
      '"ecosystem governance" OR circularity',
    );
  });

  it("works on titles with accents, hyphens and numbers", () => {
    const q = suggestRuleQuery(
      "Private and state-owned banks in times of high instability. Mexico 1977–1990",
    );
    expect(q).toContain("state-owned banks");
    expect(() => parseQuery(q)).not.toThrow();
  });

  it("returns an empty suggestion when nothing is usable", () => {
    expect(suggestRuleQuery("Editorial")).toBe("");
    expect(suggestRuleQuery("Issue Information")).toBe("");
  });

  it("always produces queries the parser accepts", () => {
    for (const t of [
      "Investors' ideology and corporate symbolic and substantive climate actions",
      "Pay‐for‐prominence: The (un)intended consequences of monetary incentives",
      "Considerato la pestifera voragine et pessimo verme dell’usura",
      "A platform for change? Core component innovations, complementor adaptation",
    ]) {
      const q = suggestRuleQuery(t);
      if (q) expect(() => parseQuery(q), `${t} → ${q}`).not.toThrow();
    }
  });
});

describe("labels and authors", () => {
  it("labels a rule by its first phrase", () => {
    expect(labelFromQuery('"imperial episteme" OR "business schools"')).toBe(
      "Imperial episteme",
    );
  });

  it("recognises an already-watched author by ORCID or name + initial", () => {
    const watched = [
      { id: "a1", family: "Del Ángel", given: "Gustavo", weight: 5 },
      { id: "a2", family: "Iorio", orcid: "0000-0002-3933-920X", weight: 5 },
    ];
    expect(isWatched({ family: "Del Angel", given: "G." }, watched)).toBe(true);
    expect(
      isWatched({ family: "Iorio", orcid: "0000-0002-3933-920X" }, watched),
    ).toBe(true);
    expect(isWatched({ family: "Chandler", given: "Alfred" }, watched)).toBe(
      false,
    );
    expect(authorName({ family: "Chandler", given: "Alfred D." })).toBe(
      "Alfred D. Chandler",
    );
  });
});
