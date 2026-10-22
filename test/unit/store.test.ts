import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  compileScoring,
  DEFAULT_SCORING,
  scoreItem,
} from "../../src/core/rules";
import { Store, type Db } from "../../src/core/store";
import type { RadarItem } from "../../src/core/types";
import { LRP, SMJ } from "./journals";

/** node:sqlite behind the same interface the Zotero adapter implements. */
function memoryDb(): Db {
  const d = new DatabaseSync(":memory:");
  const norm = (p: unknown[]) =>
    p.map((v) => (v === undefined ? null : v)) as any[];
  return {
    async query(sql, params = []) {
      return d.prepare(sql).all(...norm(params)) as Record<string, unknown>[];
    },
    async run(sql, params = []) {
      d.prepare(sql).run(...norm(params));
    },
    async transaction(fn) {
      d.exec("BEGIN");
      try {
        const r = await fn();
        d.exec("COMMIT");
        return r;
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

const item = (over: Partial<RadarItem>): RadarItem => ({
  key: "doi:10.1/a",
  doi: "10.1/a",
  title: "A paper",
  authors: [],
  journalId: SMJ.id,
  journalTitle: SMJ.title,
  sources: ["crossref"],
  titleOnly: true,
  ...over,
});

describe("Store", () => {
  let db: Db;
  let store: Store;
  let clock = 0;
  beforeEach(async () => {
    db = memoryDb();
    clock = 0;
    store = new Store(
      db,
      () => `2026-10-22T00:00:${String(clock++).padStart(2, "0")}Z`,
    );
    await store.init();
  });

  it("init is idempotent and records the schema version", async () => {
    await store.init();
    const [row] = await db.query(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    expect(row.value).toBe("1");
  });

  it("refuses a database from a newer plugin version", async () => {
    await db.run("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
    await expect(store.init()).rejects.toThrow(/newer Research Radar/);
  });

  it("reports new items once, then as seen", async () => {
    const first = await store.upsertItems([item({})]);
    const second = await store.upsertItems([
      item({ abstract: "Now with abstract." }),
    ]);
    expect(first[0].isNew).toBe(true);
    expect(second[0].isNew).toBe(false);
    expect(second[0].item).toMatchObject({
      abstract: "Now with abstract.",
      titleOnly: false,
    });
    expect(await store.allItems()).toHaveLength(1);
  });

  it("joins a DOI-less feed item with its later Crossref record by title", async () => {
    const feed = item({
      key: "t:abcd1234",
      doi: undefined,
      title: "Ecosystem governance for circularity",
      journalId: LRP.id,
      sources: ["rss"],
    });
    const crossref = item({
      key: "doi:10.1016/j.lrp.2026.1",
      doi: "10.1016/j.lrp.2026.1",
      title: "Ecosystem Governance for Circularity",
      journalId: LRP.id,
    });
    await store.upsertItems([feed]);
    const [r] = await store.upsertItems([crossref]);
    expect(r.isNew).toBe(false);
    expect(r.item).toMatchObject({
      key: "t:abcd1234",
      doi: "10.1016/j.lrp.2026.1",
      sources: ["rss", "crossref"],
    });
    expect(await store.allItems()).toHaveLength(1);
  });

  it("does not merge two different DOIs that share a title", async () => {
    await store.upsertItems([
      item({ key: "doi:10.1/ed1", doi: "10.1/ed1", title: "Editorial" }),
    ]);
    const [r] = await store.upsertItems([
      item({ key: "doi:10.1/ed2", doi: "10.1/ed2", title: "Editorial" }),
    ]);
    expect(r.isNew).toBe(true);
  });

  it("keeps scores and links with items, and tracks link status", async () => {
    const it1 = item({ title: "Corporate failure" });
    await store.upsertItems([it1]);
    const compiled = compileScoring({
      ...DEFAULT_SCORING,
      rules: [{ id: "r", query: '"corporate failure"', weight: 1 }],
    });
    await store.saveScores([{ key: it1.key, score: scoreItem(it1, compiled) }]);
    await store.addLink(it1.key, 1, 4242, "possible");
    expect(await store.ownedZoteroItemIds()).toEqual(new Set([4242]));
    await store.setLinkStatus(it1.key, "kept");
    const [stored] = await store.allItems();
    expect(stored.score).toMatchObject({ tier: "possible", total: 3 });
    expect(stored.link).toMatchObject({
      zoteroItemId: 4242,
      status: "kept",
      tier: "possible",
    });
    expect(await store.linksByStatus("active")).toEqual([]);
    expect((await store.linkForZoteroItem(4242))?.key).toBe(it1.key);
  });

  it("tracks per-journal fetch progress and errors separately", async () => {
    expect(await store.journalFetchedThrough(SMJ.id)).toBeUndefined();
    await store.recordJournalFetch(SMJ.id, { through: "2026-10-22" });
    await store.recordJournalFetch(SMJ.id, { error: "HTTP 503" });
    expect(await store.journalFetchedThrough(SMJ.id)).toBe("2026-10-22");
  });

  it("rolls back a failed batch", async () => {
    const bad = item({ key: "doi:10.1/b", doi: "10.1/b" });
    // journal_id is NOT NULL: the second item makes the whole batch fail
    await expect(
      store.upsertItems([
        bad,
        item({ key: "doi:10.1/c", doi: "10.1/c", journalId: null as any }),
      ]),
    ).rejects.toThrow();
    expect(await store.allItems()).toHaveLength(0);
  });

  it("numbers runs", async () => {
    const a = await store.startRun();
    await store.finishRun(a, { new: 3 });
    expect(await store.startRun()).toBe(a + 1);
  });
});

describe("Store flags", () => {
  it("marks first-fetch feed items as baseline and remembers library duplicates", async () => {
    const db = memoryDb();
    const store = new Store(db);
    await store.init();
    const old = item({
      key: "doi:10.1/old",
      doi: "10.1/old",
      sources: ["rss"],
    });
    const fresh = item({ key: "doi:10.1/new", doi: "10.1/new" });
    await store.upsertItems([old, fresh], {
      baseline: (i) => !i.sources.includes("crossref"),
    });
    await store.markInLibrary(fresh.key);
    const all = await store.allItems();
    const byKey = Object.fromEntries(all.map((s) => [s.item.key, s]));
    expect(byKey["doi:10.1/old"]).toMatchObject({
      baseline: true,
      inLibrary: false,
    });
    expect(byKey["doi:10.1/new"]).toMatchObject({
      baseline: false,
      inLibrary: true,
    });
  });
});

describe("Store read cleaning", () => {
  it("decodes journal names stored escaped by earlier versions", async () => {
    const db = memoryDb();
    const store = new Store(db);
    await store.init();
    await store.upsertItems([
      item({ journalTitle: "Enterprise &amp; Society" }),
    ]);
    const [s] = await store.allItems();
    expect(s.item.journalTitle).toBe("Enterprise & Society");
    expect((await store.getItem(s.item.key))?.journalTitle).toBe(
      "Enterprise & Society",
    );
  });
});
