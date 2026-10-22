import { noteHtml } from "../core/explain";
import type { Tier } from "../core/rules";
import type { RadarItem } from "../core/types";
import type { ScoreResult } from "../core/rules";
import { getPref, setPref } from "../utils/prefs";

/**
 * Everything that writes to the user's Zotero library. Safety rules:
 * - only items the plugin created (recorded in its own store) are ever
 *   modified or trashed; callers pass those ids in;
 * - nothing is deleted permanently: cleanup moves items to the Trash.
 */

export interface RadarCollections {
  radar: number;
  high: number;
  possible: number;
}

export const userLibraryID = () => Zotero.Libraries.userLibraryID;

function liveCollection(id: number): Zotero.Collection | null {
  if (!id) return null;
  const c = Zotero.Collections.get(id) as Zotero.Collection | false;
  if (!c || (c as any).deleted || c.libraryID !== userLibraryID()) return null;
  return c;
}

async function createCollection(
  name: string,
  parentID?: number,
): Promise<number> {
  const c = new Zotero.Collection({
    name,
    libraryID: userLibraryID(),
    ...(parentID ? { parentID } : {}),
  });
  return (await c.saveTx()) as number;
}

/** The Radar, Radar/High and Radar/Possible collections; created if missing or trashed. */
export async function ensureCollections(): Promise<RadarCollections> {
  let radar = liveCollection(getPref("collectionRadar"))?.id;
  if (!radar) {
    radar = await createCollection("Radar");
    setPref("collectionRadar", radar);
  }
  const sub = async (
    key: "collectionHigh" | "collectionPossible",
    name: string,
  ) => {
    const c = liveCollection(getPref(key));
    if (c && c.parentID === radar) return c.id;
    const id = await createCollection(name, radar);
    setPref(key, id);
    return id;
  };
  return {
    radar,
    high: await sub("collectionHigh", "High"),
    possible: await sub("collectionPossible", "Possible"),
  };
}

/** Is there already a (non-trashed) item with this DOI in the user's library? Read-only query. */
export async function libraryHasDoi(doi: string): Promise<boolean> {
  const fieldID = Zotero.ItemFields.getID("DOI");
  if (!fieldID) return false;
  const d = doi.toLowerCase();
  const found = await Zotero.DB.valueQueryAsync(
    `SELECT 1 FROM items
       JOIN itemData USING (itemID)
       JOIN itemDataValues USING (valueID)
     WHERE items.libraryID = ? AND itemData.fieldID = ?
       AND LOWER(value) IN (?, ?, ?, ?)
       AND itemID NOT IN (SELECT itemID FROM deletedItems)
     LIMIT 1`,
    [
      userLibraryID(),
      fieldID,
      d,
      `https://doi.org/${d}`,
      `http://dx.doi.org/${d}`,
      `doi:${d}`,
    ],
  );
  return !!found;
}

/** Create the journal article, its explanation note and tags, in one transaction. Returns the item id. */
export async function createRadarItem(
  item: RadarItem,
  score: ScoreResult,
  tier: Exclude<Tier, "rest">,
  collections: RadarCollections,
  fetchedOn: string,
  addedByHand = false,
): Promise<number> {
  const zi = new Zotero.Item("journalArticle");
  zi.libraryID = userLibraryID();
  const set = (field: string, value: string | undefined) => {
    if (value) zi.setField(field as any, value);
  };
  set("title", item.title);
  set("abstractNote", item.abstract);
  set("publicationTitle", item.journalTitle);
  set("DOI", item.doi);
  set("date", item.date);
  set(
    "url",
    item.url ?? (item.doi ? `https://doi.org/${item.doi}` : undefined),
  );
  set("volume", item.volume);
  set("issue", item.issue);
  set("pages", item.pages);
  set("ISSN", item.journalId.startsWith("feed:") ? undefined : item.journalId);
  set("libraryCatalog", "Research Radar");
  zi.setCreators(
    item.authors.map((a) =>
      a.given
        ? { firstName: a.given, lastName: a.family, creatorType: "author" }
        : { lastName: a.family, fieldMode: 1, creatorType: "author" },
    ) as any,
  );
  zi.addTag("radar");
  zi.addTag(`radar:${tier}`);
  zi.setCollections([
    tier === "high" ? collections.high : collections.possible,
  ]);

  const note = new Zotero.Item("note");
  note.libraryID = userLibraryID();
  note.setNote(
    noteHtml(score, { fetchedOn, sources: item.sources, addedByHand }),
  );

  await Zotero.DB.executeTransaction(async () => {
    await zi.save();
    note.parentID = zi.id;
    await note.save();
  });
  return zi.id;
}

export type CleanupVerdict = "trash" | "kept" | "gone";

/**
 * Decide what to do with an old, untouched-looking Radar item. "kept" if the
 * user has filed it elsewhere or added notes/attachments; "gone" if it no
 * longer exists or is already in the Trash.
 */
export function cleanupVerdict(
  itemID: number,
  radar: RadarCollections,
): CleanupVerdict {
  const zi = Zotero.Items.get(itemID) as Zotero.Item | false;
  if (!zi || zi.deleted) return "gone";
  const ours = new Set([radar.radar, radar.high, radar.possible]);
  if (zi.getCollections().some((id: number) => !ours.has(id))) return "kept";
  if (zi.numAttachments() > 0 || zi.numNotes() > 1) return "kept";
  return "trash";
}

/** Move a plugin-created item to the Trash (undoable; never a permanent delete). */
export async function trashItem(itemID: number): Promise<void> {
  const zi = Zotero.Items.get(itemID) as Zotero.Item | false;
  if (!zi || zi.deleted) return;
  zi.deleted = true;
  await zi.saveTx();
}

export function radarCollectionIds(): Set<number> {
  return new Set(
    [
      getPref("collectionRadar"),
      getPref("collectionHigh"),
      getPref("collectionPossible"),
    ].filter((id) => !!id),
  );
}
