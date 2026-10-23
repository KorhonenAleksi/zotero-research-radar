import { fold } from "./text";
import type { StoredItem } from "./store";

export type TierFilter = "all" | "high" | "possible" | "rest" | "excluded";
export type SortOrder = "newest" | "points" | "ai";

export interface ViewFilter {
  tier: TierFilter;
  journalId: string; // "" = all journals
  text: string;
  sort: SortOrder;
}

export const DEFAULT_FILTER: ViewFilter = {
  tier: "all",
  journalId: "",
  text: "",
  sort: "newest",
};

/** Where an article stands, in the user's terms. */
export function statusLabel(s: StoredItem): string {
  if (s.link) {
    switch (s.link.status) {
      case "active":
        return "In Radar";
      case "kept":
        return "Kept";
      case "dismissed":
        return "Dismissed";
      case "expired":
        return "Cleaned up";
      case "removed":
        return "Removed";
    }
  }
  if (s.inLibrary) return "Already in library";
  if (s.baseline) return "Older feed item";
  return "";
}

/** Can the user pull this article into the Radar collection by hand? */
export function canAddToRadar(s: StoredItem): boolean {
  return !s.link && !s.inLibrary;
}

function matchesTier(s: StoredItem, tier: TierFilter): boolean {
  if (tier === "all") return true;
  if (tier === "excluded") return !!s.score?.excluded;
  if (s.score?.excluded) return false;
  return (s.score?.tier ?? "rest") === tier;
}

function haystack(s: StoredItem): string {
  const authors = s.item.authors
    .map((a) => `${a.given ?? ""} ${a.family}`)
    .join(" ");
  return fold(
    `${s.item.title} ${authors} ${s.item.journalTitle} ${s.item.doi ?? ""}`,
  );
}

/** Filter and sort stored articles for the "All fetched articles" window. */
export function filterItems(stored: StoredItem[], f: ViewFilter): StoredItem[] {
  const words = fold(f.text).split(/\s+/).filter(Boolean);
  const rows = stored.filter(
    (s) =>
      matchesTier(s, f.tier) &&
      (!f.journalId || s.item.journalId === f.journalId) &&
      (words.length === 0 || words.every((w) => haystack(s).includes(w))),
  );
  const byNewest = (a: StoredItem, b: StoredItem) =>
    b.firstSeen.localeCompare(a.firstSeen) ||
    (b.item.date ?? "").localeCompare(a.item.date ?? "");
  const byPoints = (a: StoredItem, b: StoredItem) =>
    (b.score?.total ?? 0) - (a.score?.total ?? 0);
  // Unrated articles go below every rated one, including the 0s
  const byAi = (a: StoredItem, b: StoredItem) =>
    (b.ai?.score ?? -1) - (a.ai?.score ?? -1);
  return rows.sort(
    f.sort === "points"
      ? (a, b) => byPoints(a, b) || byNewest(a, b)
      : f.sort === "ai"
        ? (a, b) => byAi(a, b) || byPoints(a, b) || byNewest(a, b)
        : byNewest,
  );
}

/** Counts per tier, for the filter menu ("Rest (412)"). */
export function tierCounts(stored: StoredItem[]): Record<TierFilter, number> {
  const c: Record<TierFilter, number> = {
    all: stored.length,
    high: 0,
    possible: 0,
    rest: 0,
    excluded: 0,
  };
  for (const s of stored) {
    if (s.score?.excluded) c.excluded++;
    else c[s.score?.tier ?? "rest"]++;
  }
  return c;
}

/** Journals present in the store, alphabetically, for the journal filter. */
export function journalOptions(
  stored: StoredItem[],
): Array<{ id: string; title: string; count: number }> {
  const m = new Map<string, { id: string; title: string; count: number }>();
  for (const s of stored) {
    const e = m.get(s.item.journalId) ?? {
      id: s.item.journalId,
      title: s.item.journalTitle,
      count: 0,
    };
    e.count++;
    m.set(s.item.journalId, e);
  }
  return [...m.values()].sort((a, b) => a.title.localeCompare(b.title));
}
