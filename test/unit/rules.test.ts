import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapWorks } from "../../src/core/crossref";
import { summarize } from "../../src/core/explain";
import { parseFeed } from "../../src/core/feed";
import { mergeItems } from "../../src/core/merge";
import { evaluate, parseQuery, QueryError } from "../../src/core/query";
import {
  compileScoring,
  DEFAULT_SCORING,
  scoreItem,
  type ScoringSettings,
} from "../../src/core/rules";
import { prepare } from "../../src/core/text";
import type { RadarItem } from "../../src/core/types";
import { BH, LRP, SMJ } from "./journals";

const matches = (q: string, text: string) =>
  evaluate(parseQuery(q), prepare(text));

describe("text normalisation", () => {
  it("matches British and American spellings both ways", () => {
    expect(
      matches("organization", "Organisational change and the organisation"),
    ).toBe(true);
    expect(
      matches('"organisational decline"', "Organizational decline in firms"),
    ).toBe(true);
    expect(matches("analyse", "We analyze archives")).toBe(true);
  });

  it("folds accents", () => {
    expect(matches("obloj", "Krzysztof Obłój")).toBe(true);
  });
});

describe("query language", () => {
  it("stems words", () => {
    expect(matches("decline", "Declining firms")).toBe(true);
  });

  it("supports phrases, OR, NOT and implicit AND", () => {
    expect(matches('"corporate failure" OR bankruptcy', "Bankruptcy law")).toBe(
      true,
    );
    expect(matches('"corporate failure"', "Failure of corporate boards")).toBe(
      false,
    );
    expect(matches("strategy history", "History of strategy")).toBe(true);
    expect(matches("strategy history", "Strategy and finance")).toBe(false);
    expect(matches("strategy NOT finance", "Strategy and finance")).toBe(false);
    expect(matches("(decline OR failure) AND firm*", "Failure of firms")).toBe(
      true,
    );
  });

  it("supports prefix wildcards for word families", () => {
    expect(matches("histor*", "A historical perspective")).toBe(true);
    expect(matches("histor*", "Historiography in organization studies")).toBe(
      true,
    );
    expect(matches("histor*", "Hysteresis")).toBe(false);
  });

  it("treats lower-case and/or as ordinary words", () => {
    expect(() => parseQuery("mergers and acquisitions")).not.toThrow();
  });

  it("gives readable errors", () => {
    expect(() => parseQuery("")).toThrow(QueryError);
    expect(() => parseQuery('"open phrase')).toThrow(/quotation mark/);
    expect(() => parseQuery("(a OR b")).toThrow(/parenthesis/);
    expect(() => parseQuery("strategy OR")).toThrow(/ends with an operator/);
    expect(() => parseQuery("hi*")).toThrow(/3 letters/);
  });
});

const item = (over: Partial<RadarItem>): RadarItem => ({
  key: "doi:10.1/x",
  title: "",
  authors: [],
  journalId: SMJ.id,
  journalTitle: SMJ.title,
  sources: ["crossref"],
  titleOnly: !over.abstract,
  ...over,
});

const settings = (over: Partial<ScoringSettings>) =>
  compileScoring({ ...DEFAULT_SCORING, ...over });

describe("scoreItem", () => {
  const decline = {
    id: "r1",
    label: "Decline",
    query: '"organizational decline" OR "corporate failure"',
    weight: 1,
  };

  it("weights a title match above an abstract match", () => {
    const s = settings({ rules: [decline] });
    const inTitle = scoreItem(
      item({ title: "Organisational decline revisited" }),
      s,
    );
    const inAbstract = scoreItem(
      item({
        title: "Firms over time",
        abstract: "We study corporate failure.",
      }),
      s,
    );
    expect(inTitle).toMatchObject({ total: 3, tier: "possible" });
    expect(inTitle.reasons[0]).toMatchObject({
      field: "title",
      terms: ['"organizational decline"'],
    });
    // Any match is worth a look: an abstract-only hit is Possible, not Rest
    expect(inAbstract).toMatchObject({ total: 1, tier: "possible" });
    expect(inAbstract.reasons[0]).toMatchObject({ field: "abstract" });
  });

  it("first real run (22 Oct): abstract-only 'strateg*' matches reach Possible", () => {
    const s = settings({
      rules: [{ id: "r", query: "strateg* OR histor*", weight: 1 }],
    });
    const r = scoreItem(
      item({
        title: "Platform development in incumbent firms",
        abstract:
          "We examine how incumbents' strategic choices shape platforms.",
      }),
      s,
    );
    expect(r).toMatchObject({ tier: "possible", total: 1 });
    expect(scoreItem(item({ title: "Issue Information" }), s).tier).toBe(
      "rest",
    );
  });

  it("matches watched authors by ORCID, and does not confuse namesakes", () => {
    const s = settings({
      authors: [
        {
          id: "a1",
          family: "Iorio",
          given: "Alessandro",
          orcid: "0000-0002-3933-920X",
          weight: 5,
        },
      ],
    });
    const same = item({
      authors: [{ given: "A.", family: "Iorio", orcid: "0000-0002-3933-920X" }],
    });
    const namesake = item({
      authors: [
        { given: "Alessandro", family: "Iorio", orcid: "0000-0001-0000-0000" },
      ],
    });
    const noOrcid = item({
      authors: [{ given: "Alessandro", family: "Iorio" }],
    });
    expect(scoreItem(same, s)).toMatchObject({
      tier: "high",
      reasons: [{ via: "orcid" }],
    });
    expect(scoreItem(namesake, s).tier).toBe("rest");
    expect(scoreItem(noOrcid, s)).toMatchObject({
      tier: "high",
      reasons: [{ via: "name" }],
    });
  });

  it("requires a matching first initial when the watched author has a given name", () => {
    const s = settings({
      authors: [{ id: "a1", family: "Chandler", given: "Alfred", weight: 5 }],
    });
    expect(
      scoreItem(
        item({ authors: [{ given: "Alfred D.", family: "Chandler" }] }),
        s,
      ).tier,
    ).toBe("high");
    expect(
      scoreItem(item({ authors: [{ given: "Mark", family: "Chandler" }] }), s)
        .tier,
    ).toBe("rest");
  });

  it("adds the journal bonus only when something else matched", () => {
    const s = settings({ rules: [decline], journalBonus: { [SMJ.id]: 2 } });
    expect(scoreItem(item({ title: "Unrelated" }), s).total).toBe(0);
    expect(scoreItem(item({ title: "Corporate failure" }), s)).toMatchObject({
      total: 5,
      tier: "high",
    });
  });

  it("hides excluded items but still explains them", () => {
    const s = settings({
      rules: [
        decline,
        {
          id: "x",
          label: "Finance",
          query: "financ*",
          weight: 0,
          exclude: true,
        },
      ],
    });
    const r = scoreItem(
      item({ title: "Corporate failure and financial distress" }),
      s,
    );
    expect(r).toMatchObject({ excluded: true, tier: "rest", total: 3 });
    expect(summarize(r)).toMatch(/^Excluded: .*excluded by Finance: financ\*/);
  });

  it("reports broken rules instead of failing", () => {
    const s = settings({
      rules: [decline, { id: "bad", query: "(oops", weight: 1 }],
    });
    expect(s.rules).toHaveLength(1);
    expect(s.errors).toEqual([
      { ruleId: "bad", message: "A parenthesis is not closed." },
    ]);
  });

  it("flags title-only items in the explanation", () => {
    const s = settings({ rules: [decline] });
    expect(summarize(scoreItem(item({ title: "Corporate failure" }), s))).toBe(
      'Possible 3: title matched "corporate failure" (Decline, +3); title-only: no abstract available',
    );
  });
});

describe("realistic rule set over the real fixtures", () => {
  const fx = (n: string) =>
    readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
  const items = [
    ...mergeItems(
      mapWorks(JSON.parse(fx("crossref-works-smj.json")), SMJ),
      parseFeed(fx("rss-smj.xml"), SMJ),
    ),
    ...mergeItems(
      mapWorks(JSON.parse(fx("crossref-works-lrp.json")), LRP),
      parseFeed(fx("rss-lrp.xml"), LRP),
    ),
    ...mergeItems(
      mapWorks(JSON.parse(fx("crossref-works-bh.json")), BH),
      parseFeed(fx("rss-bh.xml"), BH),
    ),
  ];
  const s = settings({
    rules: [
      {
        id: "1",
        label: "History",
        query: "histor* OR archiv* OR longitudinal",
        weight: 1,
      },
      { id: "2", label: "Ecosystems", query: "ecosystem*", weight: 1 },
      { id: "3", label: "Banking", query: "bank*", weight: 1 },
    ],
  });
  const results = items.map((i) => ({ i, r: scoreItem(i, s) }));
  const byTier = (t: string) => results.filter((x) => x.r.tier === t);

  it("ranks every item and drops none", () => {
    expect(results.length).toBe(items.length);
    expect(
      byTier("high").length + byTier("possible").length + byTier("rest").length,
    ).toBe(items.length);
  });

  it("finds the ecosystem papers in Long Range Planning by title", () => {
    const eco = results.filter(
      (x) =>
        x.i.journalId === LRP.id &&
        x.r.reasons.some((r) => r.kind === "rule" && r.label === "Ecosystems"),
    );
    expect(eco.length).toBeGreaterThanOrEqual(5);
    expect(eco.every((x) => x.r.tier !== "rest")).toBe(true);
  });

  it("finds the Mexican banking article in Business History", () => {
    const banks = results.find((x) =>
      x.i.title.startsWith("Private and state-owned banks"),
    )!;
    expect(banks.r.tier).toBe("possible");
    expect(summarize(banks.r)).toContain("title-only");
  });
});
