import type { Db } from "../core/store";

/**
 * The plugin's own database: researchradar.sqlite in the Zotero data
 * directory. Zotero's own zotero.sqlite is never touched.
 */
export function openZoteroDb(): { db: Db; close: () => Promise<void> } {
  const conn = new Zotero.DBConnection("researchradar");
  const db: Db = {
    async query(sql, params = [], cols = []) {
      const rows = (await conn.queryAsync(sql, params as any)) ?? [];
      // Zotero's row objects only expose columns by name, so copy the named ones
      return rows.map((row: any) =>
        Object.fromEntries(cols.map((c) => [c, row[c]])),
      );
    },
    async run(sql, params = []) {
      await conn.queryAsync(sql, params as any);
    },
    transaction(fn) {
      return conn.executeTransaction(fn) as any;
    },
  };
  return { db, close: () => conn.closeDatabase(true) };
}
