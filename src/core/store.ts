import type { AiJudgement } from "./ai";
import { titleKey } from "./itemKey";
import { stripMarkup } from "./markup";
import type { ScoreResult, Tier } from "./rules";
import type { RadarItem } from "./types";

/**
 * Minimal async SQL interface. Inside Zotero it wraps Zotero.DBConnection
 * (src/zotero/db.ts); in unit tests it wraps node:sqlite. `cols` names the
 * selected columns so adapters can return plain objects.
 */
export interface Db {
  query(
    sql: string,
    params?: unknown[],
    cols?: string[],
  ): Promise<Record<string, unknown>[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** What happened to an item the plugin put into the Radar collection. */
export type LinkStatus =
  | "active" // in Radar, untouched
  | "kept" // user added it to one of their own collections
  | "dismissed" // user trashed or deleted it: negative feedback
  | "expired" // cleanup trashed it after N days
  | "removed"; // removed by "Remove all Radar items"

export interface Link {
  key: string;
  libraryId: number;
  zoteroItemId: number;
  tier: Tier;
  status: LinkStatus;
  createdAt: string;
  statusAt: string;
}

export interface StoredItem {
  item: RadarItem;
  firstSeen: string;
  lastSeen: string;
  /** Seen in a feed on the journal's first fetch: old backlog, never announced. */
  baseline: boolean;
  /** The user already had this article in their library; never written. */
  inLibrary: boolean;
  score?: ScoreResult;
  /** Optional AI judgement (may be outdated: compare its context). */
  ai?: AiJudgement;
  link?: Link;
}

const SCHEMA_VERSION = 2;

const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS items (
      key TEXT PRIMARY KEY,
      title_key TEXT NOT NULL,
      journal_id TEXT NOT NULL,
      doi TEXT,
      data TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      baseline INTEGER NOT NULL DEFAULT 0,
      in_library INTEGER NOT NULL DEFAULT 0)`,
    "CREATE INDEX IF NOT EXISTS items_title_key ON items(title_key)",
    `CREATE TABLE IF NOT EXISTS scores (
      key TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      total REAL NOT NULL,
      excluded INTEGER NOT NULL,
      result TEXT NOT NULL,
      scored_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS links (
      key TEXT PRIMARY KEY,
      library_id INTEGER NOT NULL,
      zotero_item_id INTEGER NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS links_item ON links(zotero_item_id)",
    `CREATE TABLE IF NOT EXISTS journal_state (
      journal_id TEXT PRIMARY KEY,
      fetched_through TEXT,
      last_ok TEXT,
      last_error TEXT)`,
    `CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      summary TEXT)`,
  ],
  // 0.7.0: optional AI judgements, one per article
  2: [
    `CREATE TABLE IF NOT EXISTS ai_scores (
      key TEXT PRIMARY KEY,
      judgement TEXT NOT NULL,
      judged_at TEXT NOT NULL)`,
  ],
};

export class Store {
  constructor(
    private db: Db,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  async init(): Promise<void> {
    await this.db.run(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)",
    );
    const rows = await this.db.query(
      "SELECT value FROM meta WHERE key = 'schema_version'",
      [],
      ["value"],
    );
    let version = rows.length ? Number(rows[0].value) : 0;
    if (version > SCHEMA_VERSION)
      throw new Error(
        `Database is from a newer Research Radar (schema ${version}); please update the plugin.`,
      );
    while (version < SCHEMA_VERSION) {
      const next = version + 1;
      await this.db.transaction(async () => {
        for (const sql of MIGRATIONS[next]) await this.db.run(sql);
        await this.db.run(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
          [String(next)],
        );
      });
      version = next;
    }
  }

  /**
   * Save fetched items; report which are new. An item is the same as a stored
   * one if the key matches, or, when one of them lacks a DOI, if the title
   * matches within the same journal (Elsevier items arrive by RSS without a DOI
   * and by Crossref with one). The stored key is kept; metadata is refreshed.
   */
  async upsertItems(
    items: RadarItem[],
    opts: { baseline?: (item: RadarItem) => boolean } = {},
  ): Promise<Array<{ item: RadarItem; isNew: boolean }>> {
    const now = this.now();
    return this.db.transaction(async () => {
      const out: Array<{ item: RadarItem; isNew: boolean }> = [];
      for (const item of items) {
        const tKey = titleKey(item.journalId, item.title);
        let rows = await this.db.query(
          "SELECT key, data FROM items WHERE key = ?",
          [item.key],
          ["key", "data"],
        );
        if (!rows.length)
          rows = await this.db.query(
            "SELECT key, data FROM items WHERE title_key = ? AND (doi IS NULL OR ? IS NULL) LIMIT 1",
            [tKey, item.doi ?? null],
            ["key", "data"],
          );
        if (rows.length) {
          const key = String(rows[0].key);
          const old = JSON.parse(String(rows[0].data)) as RadarItem;
          const merged: RadarItem = {
            ...old,
            ...stripUndefined(item),
            key,
            doi: item.doi ?? old.doi,
            abstract: item.abstract ?? old.abstract,
            authors: item.authors.length ? item.authors : old.authors,
            sources: [...new Set([...old.sources, ...item.sources])],
          };
          merged.titleOnly = !merged.abstract;
          await this.db.run(
            "UPDATE items SET doi = ?, data = ?, last_seen = ? WHERE key = ?",
            [merged.doi ?? null, JSON.stringify(merged), now, key],
          );
          out.push({ item: merged, isNew: false });
        } else {
          await this.db.run(
            "INSERT INTO items (key, title_key, journal_id, doi, data, first_seen, last_seen, baseline) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
              item.key,
              tKey,
              item.journalId,
              item.doi ?? null,
              JSON.stringify(item),
              now,
              now,
              opts.baseline?.(item) ? 1 : 0,
            ],
          );
          out.push({ item, isNew: true });
        }
      }
      return out;
    });
  }

  async saveScores(
    entries: Array<{ key: string; score: ScoreResult }>,
  ): Promise<void> {
    const now = this.now();
    await this.db.transaction(async () => {
      for (const { key, score } of entries)
        await this.db.run(
          "INSERT OR REPLACE INTO scores (key, tier, total, excluded, result, scored_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            key,
            score.tier,
            score.total,
            score.excluded ? 1 : 0,
            JSON.stringify(score),
            now,
          ],
        );
    });
  }

  /** Every stored item with its score and Radar link, newest first. */
  async allItems(): Promise<StoredItem[]> {
    const cols = [
      "data",
      "first_seen",
      "last_seen",
      "baseline",
      "in_library",
      "result",
      "judgement",
      "library_id",
      "zotero_item_id",
      "ltier",
      "status",
      "created_at",
      "status_at",
    ];
    const rows = await this.db.query(
      `SELECT i.data, i.first_seen, i.last_seen, i.baseline, i.in_library, s.result, a.judgement,
              l.library_id, l.zotero_item_id, l.tier AS ltier, l.status, l.created_at, l.status_at
       FROM items i
       LEFT JOIN scores s ON s.key = i.key
       LEFT JOIN links l ON l.key = i.key
       LEFT JOIN ai_scores a ON a.key = i.key
       ORDER BY i.first_seen DESC, i.key`,
      [],
      cols,
    );
    return rows.map((r) => {
      const item = readItem(r.data);
      return {
        item,
        firstSeen: String(r.first_seen),
        lastSeen: String(r.last_seen),
        baseline: Number(r.baseline) === 1,
        inLibrary: Number(r.in_library) === 1,
        score: r.result
          ? (JSON.parse(String(r.result)) as ScoreResult)
          : undefined,
        ai: r.judgement
          ? (JSON.parse(String(r.judgement)) as AiJudgement)
          : undefined,
        link: r.zotero_item_id != null ? rowToLink(item.key, r) : undefined,
      };
    });
  }

  /** One stored article by key (e.g. to recover ORCIDs for a Radar item). */
  async getItem(key: string): Promise<RadarItem | undefined> {
    const rows = await this.db.query(
      "SELECT data FROM items WHERE key = ?",
      [key],
      ["data"],
    );
    return rows.length ? readItem(rows[0].data) : undefined;
  }

  async saveAiJudgement(key: string, judgement: AiJudgement): Promise<void> {
    await this.db.run(
      "INSERT OR REPLACE INTO ai_scores (key, judgement, judged_at) VALUES (?, ?, ?)",
      [key, JSON.stringify(judgement), this.now()],
    );
  }

  /** The user already has this article; it will never be written. */
  async markInLibrary(key: string): Promise<void> {
    await this.db.run("UPDATE items SET in_library = 1 WHERE key = ?", [key]);
  }

  async addLink(
    key: string,
    libraryId: number,
    zoteroItemId: number,
    tier: Tier,
  ): Promise<void> {
    const now = this.now();
    await this.db.run(
      "INSERT OR REPLACE INTO links (key, library_id, zotero_item_id, tier, status, created_at, status_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      [key, libraryId, zoteroItemId, tier, now, now],
    );
  }

  async linksByStatus(status: LinkStatus): Promise<Link[]> {
    const cols = [
      "key",
      "library_id",
      "zotero_item_id",
      "ltier",
      "status",
      "created_at",
      "status_at",
    ];
    const rows = await this.db.query(
      "SELECT key, library_id, zotero_item_id, tier AS ltier, status, created_at, status_at FROM links WHERE status = ?",
      [status],
      cols,
    );
    return rows.map((r) => rowToLink(String(r.key), r));
  }

  async linkForZoteroItem(zoteroItemId: number): Promise<Link | undefined> {
    const cols = [
      "key",
      "library_id",
      "zotero_item_id",
      "ltier",
      "status",
      "created_at",
      "status_at",
    ];
    const rows = await this.db.query(
      "SELECT key, library_id, zotero_item_id, tier AS ltier, status, created_at, status_at FROM links WHERE zotero_item_id = ?",
      [zoteroItemId],
      cols,
    );
    return rows.length ? rowToLink(String(rows[0].key), rows[0]) : undefined;
  }

  /** Zotero item ids the plugin created. Nothing outside this set is ever modified. */
  async ownedZoteroItemIds(): Promise<Set<number>> {
    const rows = await this.db.query(
      "SELECT zotero_item_id FROM links",
      [],
      ["zotero_item_id"],
    );
    return new Set(rows.map((r) => Number(r.zotero_item_id)));
  }

  async setLinkStatus(key: string, status: LinkStatus): Promise<void> {
    await this.db.run(
      "UPDATE links SET status = ?, status_at = ? WHERE key = ?",
      [status, this.now(), key],
    );
  }

  async journalFetchedThrough(journalId: string): Promise<string | undefined> {
    const rows = await this.db.query(
      "SELECT fetched_through FROM journal_state WHERE journal_id = ?",
      [journalId],
      ["fetched_through"],
    );
    return rows[0]?.fetched_through
      ? String(rows[0].fetched_through)
      : undefined;
  }

  async recordJournalFetch(
    journalId: string,
    ok: { through: string } | { error: string },
  ): Promise<void> {
    const now = this.now();
    if ("through" in ok)
      await this.db.run(
        `INSERT INTO journal_state (journal_id, fetched_through, last_ok, last_error) VALUES (?, ?, ?, NULL)
         ON CONFLICT(journal_id) DO UPDATE SET fetched_through = excluded.fetched_through, last_ok = excluded.last_ok, last_error = NULL`,
        [journalId, ok.through, now],
      );
    else
      await this.db.run(
        `INSERT INTO journal_state (journal_id, last_error) VALUES (?, ?)
         ON CONFLICT(journal_id) DO UPDATE SET last_error = excluded.last_error`,
        [journalId, ok.error],
      );
  }

  /** Fold the write-ahead log back into the database file and truncate it. */
  async checkpoint(): Promise<void> {
    await this.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  async startRun(): Promise<number> {
    await this.db.run("INSERT INTO runs (started_at) VALUES (?)", [this.now()]);
    const rows = await this.db.query(
      "SELECT MAX(id) AS id FROM runs",
      [],
      ["id"],
    );
    return Number(rows[0].id);
  }

  async finishRun(id: number, summary: unknown): Promise<void> {
    await this.db.run(
      "UPDATE runs SET finished_at = ?, summary = ? WHERE id = ?",
      [this.now(), JSON.stringify(summary), id],
    );
  }
}

function rowToLink(key: string, r: Record<string, unknown>): Link {
  return {
    key,
    libraryId: Number(r.library_id),
    zoteroItemId: Number(r.zotero_item_id),
    tier: String(r.ltier) as Tier,
    status: String(r.status) as LinkStatus,
    createdAt: String(r.created_at),
    statusAt: String(r.status_at),
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Parse a stored item; journal names saved HTML-escaped by 0.6.0 and earlier are cleaned. */
function readItem(data: unknown): RadarItem {
  const item = JSON.parse(String(data)) as RadarItem;
  item.journalTitle = stripMarkup(item.journalTitle);
  return item;
}
