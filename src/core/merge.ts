import { titleKey } from "./itemKey";
import type { RadarItem } from "./types";

function union<T>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])];
}

/** Crossref metadata wins; the feed fills gaps (above all, missing abstracts). */
function combine(primary: RadarItem, secondary: RadarItem): RadarItem {
  const abstract = primary.abstract ?? secondary.abstract;
  return {
    ...secondary,
    ...Object.fromEntries(
      Object.entries(primary).filter(([, v]) => v !== undefined),
    ),
    authors: primary.authors.length ? primary.authors : secondary.authors,
    abstract,
    sources: union(primary.sources, secondary.sources),
    titleOnly: !abstract,
  } as RadarItem;
}

/**
 * Merge Crossref and feed items for the same fetch run into one list without
 * duplicates. Items are matched on DOI, or, when the feed gives no DOI (as
 * Elsevier's doesn't), on normalised title within the same journal.
 * Nothing is dropped: an unmatched feed item is kept as its own item.
 */
export function mergeItems(
  crossrefItems: RadarItem[],
  feedItems: RadarItem[],
): RadarItem[] {
  const byKey = new Map<string, RadarItem>();
  const byTitle = new Map<string, string>(); // titleKey -> key in byKey

  // Crossref items go in first, so they are always the `existing` side
  const add = (item: RadarItem) => {
    const tKey = titleKey(item.journalId, item.title);
    const existingKey = byKey.has(item.key)
      ? item.key
      : !item.doi
        ? byTitle.get(tKey)
        : undefined;
    if (existingKey) {
      byKey.set(existingKey, combine(byKey.get(existingKey)!, item));
      return;
    }
    byKey.set(item.key, item);
    if (!byTitle.has(tKey)) byTitle.set(tKey, item.key);
  };

  for (const item of crossrefItems) add(item);
  for (const item of feedItems) add(item);
  return [...byKey.values()];
}
