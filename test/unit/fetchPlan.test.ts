import { describe, expect, it } from "vitest";
import { escapeHtml, noteHtml } from "../../src/core/explain";
import {
  emptySummary,
  popupLines,
  POPUP_LINE_MAX,
  mapPool,
  selectForAi,
  selectToWrite,
  sinceDate,
  summaryLines,
} from "../../src/core/fetchPlan";
import type { ScoreResult } from "../../src/core/rules";
import type { StoredItem } from "../../src/core/store";

const now = new Date("2026-10-22T12:00:00Z");

describe("sinceDate", () => {
  it("looks back firstFetchDays on a journal's first fetch", () => {
    expect(sinceDate(undefined, now, 30)).toBe("2026-09-22");
  });
  it("otherwise re-queries a 3-day overlap", () => {
    expect(sinceDate("2026-10-20", now, 30)).toBe("2026-10-17");
  });
});

const score = (
  tier: ScoreResult["tier"],
  total: number,
  over: Partial<ScoreResult> = {},
): ScoreResult => ({
  tier,
  total,
  excluded: false,
  titleOnly: false,
  components: { rules: total, authors: 0, journal: 0 },
  reasons: [],
  ...over,
});

let n = 0;
const stored = (over: Partial<StoredItem>): StoredItem => ({
  item: {
    key: `doi:10.1/${n++}`,
    title: "x",
    authors: [],
    journalId: "j",
    journalTitle: "J",
    sources: ["crossref"],
    titleOnly: false,
  },
  firstSeen: "2026-10-22T10:00:00Z",
  lastSeen: "2026-10-22T10:00:00Z",
  baseline: false,
  inLibrary: false,
  score: score("possible", 3),
  ...over,
});

describe("selectToWrite", () => {
  const opts = { now, windowDays: 30, max: 2 };

  it("takes High before Possible, then by points, up to the limit", () => {
    const a = stored({ score: score("possible", 4) });
    const b = stored({ score: score("high", 5) });
    const c = stored({ score: score("possible", 3) });
    const sel = selectToWrite([a, b, c], opts);
    expect(sel.write).toEqual([b, a]);
    expect(sel.waiting).toBe(1);
  });

  it("never writes Rest, excluded, baseline, already-owned or already-written items", () => {
    const skip = [
      stored({ score: score("rest", 1) }),
      stored({ score: score("high", 9, { excluded: true }) }),
      stored({ baseline: true }),
      stored({ inLibrary: true }),
      stored({
        link: {
          key: "k",
          libraryId: 1,
          zoteroItemId: 1,
          tier: "high",
          status: "dismissed",
          createdAt: "",
          statusAt: "",
        },
      }),
      stored({ score: undefined }),
      stored({ firstSeen: "2026-08-01T00:00:00Z" }), // outside the window
    ];
    expect(selectToWrite(skip, opts)).toEqual({ write: [], waiting: 0 });
  });
});

describe("summaryLines", () => {
  it("describes a run with matches, waiting items and errors", () => {
    const s = {
      ...emptySummary(),
      journals: 3,
      newItems: 40,
      written: { high: 6, possible: 11, titleOnly: 3 },
      waiting: 4,
      alreadyInLibrary: 1,
      errors: [{ journal: "Long Range Planning", message: "HTTP 503" }],
    };
    expect(summaryLines(s, 30)).toEqual([
      "6 new High, 11 Possible (3 title-only).",
      "4 more waiting (limit 30 per fetch).",
      "1 match already in your library, skipped.",
      "1 journal failed: Long Range Planning (HTTP 503)",
    ]);
  });

  it("says so when nothing matched", () => {
    expect(
      summaryLines({ ...emptySummary(), journals: 2, newItems: 1 }, 30),
    ).toEqual(["No new matches (1 new article checked in 2 journals)."]);
  });
});

describe("noteHtml", () => {
  it("escapes outside text and flags title-only", () => {
    const html = noteHtml(
      score("high", 6, {
        titleOnly: true,
        reasons: [
          {
            kind: "rule",
            label: "<b>Decline</b>",
            field: "title",
            terms: ['"corporate failure"'],
            points: 6,
          },
        ],
      }),
      { fetchedOn: "2026-10-22", sources: ["crossref", "rss"] },
    );
    expect(html).toContain("<h2>Research Radar: High (6 points)</h2>");
    expect(html).toContain("&lt;b&gt;Decline&lt;/b&gt;");
    expect(html).not.toContain("<b>Decline");
    expect(html).toContain("Title-only match");
    expect(html).toContain("via crossref + rss");
  });

  it("escapeHtml handles all special characters", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("mapPool", () => {
  it("keeps order and limits concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapPool([30, 10, 20, 5], 2, async (ms) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return ms * 2;
    });
    expect(out).toEqual([60, 20, 40, 10]);
    expect(peak).toBe(2);
  });
});

describe("popupLines", () => {
  it("keeps every line short enough for Zotero's pop-up, even with big numbers", () => {
    const worst = {
      ...emptySummary(),
      journals: 120,
      newItems: 4000,
      written: { high: 199, possible: 199, titleOnly: 199 },
      waiting: 1999,
      alreadyInLibrary: 199,
      cleanedUp: 999,
      errors: Array.from({ length: 50 }, () => ({
        journal: "Journal of the Academy of Marketing Science",
        message: "network error (offline?)",
      })),
    };
    const lines = popupLines(worst);
    expect(lines).toHaveLength(6);
    for (const l of lines)
      expect(l.length, l).toBeLessThanOrEqual(POPUP_LINE_MAX);
  });

  it("leads with the result", () => {
    const s = {
      ...emptySummary(),
      written: { high: 0, possible: 6, titleOnly: 0 },
    };
    expect(popupLines(s)).toEqual(["0 High, 6 Possible added"]);
    expect(popupLines(emptySummary())).toEqual(["No new matches"]);
  });
});

describe("noteHtml for hand-added articles", () => {
  it("says the user added it", () => {
    const html = noteHtml(score("rest", 0), {
      fetchedOn: "2026-10-22",
      sources: ["crossref"],
      addedByHand: true,
    });
    expect(html).toContain("Research Radar: Rest (0 points)");
    expect(html).toContain("You added this article by hand");
  });
});

describe("AI in selection, notes and pop-ups", () => {
  const ctx = "ctx-now";
  const judged = (scoreN: 0 | 1 | 2 | 3, context = ctx) => ({
    score: scoreN,
    interest: "decline",
    reason: "On firm failure.",
    titleOnly: true,
    model: "gemini-3.5-flash-lite",
    context,
  });

  it("writes a Rest article the AI rates 3, after rule matches", () => {
    const rule = stored({ score: score("possible", 1) });
    const ai3 = stored({ score: score("rest", 0), ai: judged(3) });
    const ai2 = stored({ score: score("rest", 0), ai: judged(2) });
    const stale = stored({ score: score("rest", 0), ai: judged(3, "old") });
    const sel = selectToWrite([ai3, ai2, stale, rule], {
      now,
      windowDays: 30,
      max: 10,
      aiContext: ctx,
    });
    expect(sel.write).toEqual([rule, ai3]);
  });

  it("lifts nothing when AI is off", () => {
    const ai3 = stored({ score: score("rest", 0), ai: judged(3) });
    expect(
      selectToWrite([ai3], { now, windowDays: 30, max: 10, aiContext: null })
        .write,
    ).toEqual([]);
  });

  it("sends only unjudged, recent, eligible articles to the AI, newest first", () => {
    const fresh = stored({ firstSeen: "2026-10-22T11:00:00Z" });
    const older = stored({ firstSeen: "2026-10-20T11:00:00Z" });
    const done = stored({ ai: judged(1) });
    const outdated = stored({ ai: judged(1, "old") });
    const skip = [
      stored({ baseline: true }),
      stored({ inLibrary: true }),
      stored({ score: score("rest", 0, { excluded: true }) }),
      stored({ firstSeen: "2026-08-01T00:00:00Z" }),
    ];
    const picked = selectForAi([older, done, ...skip, outdated, fresh], {
      now,
      windowDays: 30,
      context: ctx,
      max: 2,
    });
    expect(picked).toEqual([fresh, outdated]);
  });

  it("notes say the AI found it, and why", () => {
    const html = noteHtml(score("rest", 0, { titleOnly: true }), {
      fetchedOn: "2026-10-22",
      sources: ["crossref"],
      ai: judged(3),
      liftedByAi: true,
    });
    expect(html).toContain("Research Radar: Possible (found by AI)");
    expect(html).toContain(
      "<strong>AI (gemini-3.5-flash-lite):</strong> 3/3 (decline): On firm failure. Judged from the title only.",
    );
    expect(html).toContain("No keyword rule matched");
  });

  it("pop-up and settings mention AI finds; a skipped AI is only in the details", () => {
    const s = {
      ...emptySummary(),
      written: { high: 0, possible: 2, titleOnly: 2, byAi: 1 },
      ai: { judged: 12, skipped: "endpoint unreachable (offline or VPN?)" },
    };
    expect(popupLines(s)).toEqual([
      "0 High, 2 Possible added",
      "2 of them title-only",
      "1 of them found by AI",
    ]);
    expect(summaryLines(s, 30)).toContain(
      "AI not used: endpoint unreachable (offline or VPN?)",
    );
    expect(summaryLines(s, 30)).toContain("AI judged 12 new articles.");
  });
});
