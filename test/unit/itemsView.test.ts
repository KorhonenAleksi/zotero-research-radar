import { describe, expect, it } from "vitest";
import {
  canAddToRadar,
  DEFAULT_FILTER,
  filterItems,
  journalOptions,
  statusLabel,
  tierCounts,
} from "../../src/core/itemsView";
import type { ScoreResult } from "../../src/core/rules";
import type { StoredItem } from "../../src/core/store";

const score = (
  tier: ScoreResult["tier"],
  total: number,
  excluded = false,
): ScoreResult => ({
  tier,
  total,
  excluded,
  titleOnly: true,
  components: { rules: total, authors: 0, journal: 0 },
  reasons: [],
});

const row = (
  title: string,
  over: Partial<StoredItem> = {},
  journal = ["0007-6791", "Business History"],
): StoredItem => ({
  item: {
    key: `doi:${title}`,
    title,
    authors: [{ given: "Gustavo", family: "Del Ángel" }],
    journalId: journal[0],
    journalTitle: journal[1],
    sources: ["crossref"],
    titleOnly: true,
  },
  firstSeen: "2026-10-22T18:00:00Z",
  lastSeen: "2026-10-22T18:00:00Z",
  baseline: false,
  inLibrary: false,
  earlier: false,
  score: score("rest", 0),
  ...over,
});

const civilising = row(
  "Civilising business: The imperial episteme of early US business schools",
);
const placing = row("Placing history", {
  score: score("possible", 3),
  firstSeen: "2026-10-22T18:01:00Z",
  link: {
    key: "k",
    libraryId: 1,
    zoteroItemId: 9,
    tier: "possible",
    status: "active",
    createdAt: "",
    statusAt: "",
  },
});
const platform = row(
  "Platform development in incumbent firms",
  { score: score("high", 6) },
  ["0143-2095", "Strategic Management Journal"],
);
const finance = row("Financial distress", { score: score("rest", 3, true) });
const all = [civilising, placing, platform, finance];

describe("filterItems", () => {
  it("shows everything by default, newest first", () => {
    expect(filterItems(all, DEFAULT_FILTER)[0]).toBe(placing);
    expect(filterItems(all, DEFAULT_FILTER)).toHaveLength(4);
  });

  it("filters by tier, keeping excluded items in their own group", () => {
    expect(filterItems(all, { ...DEFAULT_FILTER, tier: "rest" })).toEqual([
      civilising,
    ]);
    expect(filterItems(all, { ...DEFAULT_FILTER, tier: "excluded" })).toEqual([
      finance,
    ]);
    expect(filterItems(all, { ...DEFAULT_FILTER, tier: "high" })).toEqual([
      platform,
    ]);
  });

  it("filters by journal and by text, ignoring accents and case", () => {
    expect(
      filterItems(all, { ...DEFAULT_FILTER, journalId: "0143-2095" }),
    ).toEqual([platform]);
    expect(
      filterItems(all, { ...DEFAULT_FILTER, text: "IMPERIAL episteme" }),
    ).toEqual([civilising]);
    expect(
      filterItems(all, { ...DEFAULT_FILTER, text: "del angel" }),
    ).toHaveLength(4);
  });

  it("sorts by points when asked", () => {
    expect(filterItems(all, { ...DEFAULT_FILTER, sort: "points" })[0]).toBe(
      platform,
    );
  });

  it("sorts by AI rating, unrated articles last", () => {
    const ai = (score: 0 | 1 | 2 | 3) => ({
      score,
      interest: "",
      reason: "",
      titleOnly: true,
      model: "m",
      context: "c",
    });
    const zero = row("Zero", { ai: ai(0) });
    const two = row("Two", { ai: ai(2) });
    const unrated = row("Unrated");
    expect(
      filterItems([unrated, zero, two], { ...DEFAULT_FILTER, sort: "ai" }),
    ).toEqual([two, zero, unrated]);
  });
});

describe("period filter", () => {
  it("separates new articles from the initial search's earlier ones", () => {
    const old = row("An older article", { earlier: true });
    const rows = [civilising, old];
    expect(filterItems(rows, { ...DEFAULT_FILTER, period: "earlier" })).toEqual(
      [old],
    );
    expect(filterItems(rows, { ...DEFAULT_FILTER, period: "new" })).toEqual([
      civilising,
    ]);
    expect(filterItems(rows, DEFAULT_FILTER)).toHaveLength(2);
    expect(statusLabel(old)).toBe("Earlier");
  });
});

describe("status and actions", () => {
  it("labels where each article stands", () => {
    expect(statusLabel(placing)).toBe("In Radar");
    expect(statusLabel(civilising)).toBe("");
    expect(statusLabel(row("x", { inLibrary: true }))).toBe(
      "Already in library",
    );
    expect(statusLabel(row("x", { baseline: true }))).toBe("Older feed item");
  });

  it("allows adding only articles that are not yet in the library", () => {
    expect(canAddToRadar(civilising)).toBe(true);
    expect(canAddToRadar(row("x", { baseline: true }))).toBe(true);
    expect(canAddToRadar(placing)).toBe(false);
    expect(canAddToRadar(row("x", { inLibrary: true }))).toBe(false);
  });

  it("allows adding back an article that was tidied or cleaned up, not a kept one", () => {
    const withStatus = (status: "tidied" | "expired" | "kept") =>
      row("x", { link: { ...placing.link!, status } });
    expect(canAddToRadar(withStatus("tidied"))).toBe(true);
    expect(canAddToRadar(withStatus("expired"))).toBe(true);
    expect(canAddToRadar(withStatus("kept"))).toBe(false);
    expect(statusLabel(withStatus("tidied"))).toBe(
      "Removed (no longer matching)",
    );
  });
});

describe("counts and journal options", () => {
  it("counts tiers with excluded separate", () => {
    expect(tierCounts(all)).toEqual({
      all: 4,
      high: 1,
      possible: 1,
      rest: 1,
      excluded: 1,
    });
  });

  it("lists journals alphabetically with counts", () => {
    expect(journalOptions(all)).toEqual([
      { id: "0007-6791", title: "Business History", count: 3 },
      { id: "0143-2095", title: "Strategic Management Journal", count: 1 },
    ]);
  });
});
