import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildEarlierWorksUrl,
  buildWorksUrl,
  mapWorks,
  nextCursor,
} from "../../src/core/crossref";
import { parseFeed } from "../../src/core/feed";
import { cleanAbstract, stripMarkup } from "../../src/core/markup";
import { mergeItems } from "../../src/core/merge";
import { BH, LRP, SMJ } from "./journals";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = (name: string) => JSON.parse(fixture(name));

describe("markup", () => {
  it("strips JATS and the leading 'Abstract' heading", () => {
    expect(
      cleanAbstract(
        "<jats:title>Abstract</jats:title><jats:sec><jats:p>We study <jats:italic>x</jats:italic> &amp; y.</jats:p></jats:sec>",
      ),
    ).toBe("We study x & y.");
  });

  it("handles markup that the feed escaped", () => {
    expect(stripMarkup("Volume 68&lt;br/&gt;. &lt;br/&gt;")).toBe(
      "Volume 68 .",
    );
  });
});

describe("buildWorksUrl", () => {
  it("ORs both ISSNs and filters to journal articles since a date", () => {
    const url = decodeURIComponent(buildWorksUrl(SMJ, "2026-09-01"));
    expect(url).toContain(
      "filter=issn:0143-2095,issn:1097-0266,from-created-date:2026-09-01,type:journal-article",
    );
    expect(url).not.toContain("mailto");
  });
});

describe("buildEarlierWorksUrl and nextCursor", () => {
  it("asks for articles published since a year, up to a date, by cursor", () => {
    const url = decodeURIComponent(
      buildEarlierWorksUrl(SMJ, 2020, "2026-09-23", {
        cursor: "AoJ+abc",
        mailto: "a@b.fi",
      }),
    );
    expect(url).toContain(
      "filter=issn:0143-2095,issn:1097-0266,from-pub-date:2020-01-01,until-created-date:2026-09-23,type:journal-article",
    );
    expect(url).toContain("rows=1000");
    expect(url).toContain("cursor=AoJ+abc");
    expect(url).toContain("mailto=a@b.fi");
    expect(buildEarlierWorksUrl(SMJ, 2020, "2026-09-23")).toContain("cursor=*");
  });

  it("follows the cursor only while pages are full", () => {
    const page = (n: number) => ({
      message: { items: Array(n).fill({}), "next-cursor": "next" },
    });
    expect(nextCursor(page(1000), 1000)).toBe("next");
    expect(nextCursor(page(999), 1000)).toBeNull();
    expect(nextCursor({}, 1000)).toBeNull();
  });
});

describe("Crossref mapping", () => {
  it("SMJ (Wiley): most items have abstracts, authors carry ORCIDs", () => {
    const items = mapWorks(json("crossref-works-smj.json"), SMJ);
    expect(items).toHaveLength(18);
    expect(items.filter((i) => !i.titleOnly)).toHaveLength(15);
    const withOrcid = items.flatMap((i) => i.authors).filter((a) => a.orcid);
    expect(withOrcid.length).toBeGreaterThan(30);
    expect(withOrcid[0].orcid).toMatch(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/);
    for (const i of items) {
      expect(i.key).toBe(`doi:${i.doi}`);
      expect(i.abstract ?? "").not.toMatch(/<|^Abstract/);
    }
  });

  it("Long Range Planning (Elsevier) and Business History (T&F): title-only", () => {
    for (const [file, journal] of [
      ["crossref-works-lrp.json", LRP],
      ["crossref-works-bh.json", BH],
    ] as const) {
      const items = mapWorks(json(file), journal);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.titleOnly)).toBe(true);
    }
  });
});

describe("feed parsing", () => {
  it("Wiley RSS 2.0: DOIs from guid and full abstracts", () => {
    const items = parseFeed(fixture("rss-smj.xml"), SMJ);
    expect(items.length).toBe(43);
    expect(items.every((i) => i.doi?.startsWith("10.1002/smj."))).toBe(true);
    const first = items[0];
    expect(first.title).toBe(
      "Investors' ideology and corporate symbolic and substantive climate actions",
    );
    expect(first.abstract).toMatch(/^Research Summary Prior research suggests/);
    // "Strategic Management Journal, EarlyView." must not count as an abstract
    expect(items.filter((i) => !i.titleOnly).length).toBeGreaterThan(30);
  });

  it("Elsevier RSS: no DOI, authors from the description, no fake abstract", () => {
    const items = parseFeed(fixture("rss-lrp.xml"), LRP);
    expect(items.length).toBeGreaterThan(10);
    const eco = items.find(
      (i) => i.title === "Ecosystem governance for circularity",
    )!;
    expect(eco.doi).toBeUndefined();
    expect(eco.key).toMatch(/^t:[0-9a-f]{8}$/);
    expect(eco.titleOnly).toBe(true);
    expect(eco.authors.map((a) => a.family)).toEqual([
      "Thomas",
      "Ritala",
      "Autio",
      "Aarikka-Stenroos",
      "Hopkinson",
      "Snihur",
    ]);
  });

  it("T&F RSS 1.0: DOIs from prism:doi, garbled creators rejected", () => {
    const items = parseFeed(fixture("rss-bh.xml"), BH);
    expect(items.length).toBe(154); // plus one <items> index, which is not an article
    expect(items.every((i) => i.doi?.startsWith("10.1080/"))).toBe(true);
    const banks = items.find((i) =>
      i.title.startsWith("Private and state-owned banks"),
    )!;
    expect(banks.authors).toEqual([]); // names+affiliations+bios in one string
    expect(banks.volume).toBe("68");
    expect(banks.titleOnly).toBe(true);
  });
});

describe("mergeItems", () => {
  it("SMJ: one item per DOI, Crossref authors kept, union of sources", () => {
    const cr = mapWorks(json("crossref-works-smj.json"), SMJ);
    const rss = parseFeed(fixture("rss-smj.xml"), SMJ);
    const merged = mergeItems(cr, rss);
    const keys = merged.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    // 16 of 18 Crossref DOIs are also in the feed
    expect(merged.filter((i) => i.sources.length === 2)).toHaveLength(16);
    expect(merged.length).toBe(18 + 43 - 16);
  });

  it("Elsevier: feed items without DOI join their Crossref record by title", () => {
    const cr = mapWorks(json("crossref-works-lrp.json"), LRP);
    const rss = parseFeed(fixture("rss-lrp.xml"), LRP);
    const merged = mergeItems(cr, rss);
    const eco = merged.filter(
      (i) => i.title === "Ecosystem governance for circularity",
    );
    expect(eco).toHaveLength(1);
    expect(eco[0].doi).toMatch(/^10\.1016\/j\.lrp\./);
    expect(eco[0].sources).toEqual(["crossref", "rss"]);
  });

  it("fills a missing Crossref abstract from the feed", () => {
    const base = {
      journalId: SMJ.id,
      journalTitle: SMJ.title,
      authors: [],
      title: "A paper",
    };
    const cr = [
      {
        ...base,
        key: "doi:10.1/x",
        doi: "10.1/x",
        sources: ["crossref" as const],
        titleOnly: true,
      },
    ];
    const rss = [
      {
        ...base,
        key: "doi:10.1/x",
        doi: "10.1/x",
        abstract: "Feed abstract.",
        sources: ["rss" as const],
        titleOnly: false,
      },
    ];
    const [m] = mergeItems(cr, rss);
    expect(m.abstract).toBe("Feed abstract.");
    expect(m.titleOnly).toBe(false);
  });
});

describe("HTML-escaped journal names from Crossref (seen 22 Oct)", () => {
  it("decodes &amp; in container titles", () => {
    const items = mapWorks(
      {
        message: {
          items: [
            {
              DOI: "10.5465/amle.2026.1",
              title: ["A paper"],
              "container-title": [
                "Academy of Management Learning &amp; Education",
              ],
            },
          ],
        },
      },
      SMJ,
    );
    expect(items[0].journalTitle).toBe(
      "Academy of Management Learning & Education",
    );
  });
});
