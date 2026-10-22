import type { StoredItem } from "./store";

const DAY = 24 * 60 * 60 * 1000;

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysBefore(day: string | Date, days: number): string {
  const t =
    typeof day === "string" ? Date.parse(`${day}T00:00:00Z`) : day.getTime();
  return isoDay(new Date(t - days * DAY));
}

/** Crossref may index a DOI a day or two after registering it, so re-query a small overlap. */
export const OVERLAP_DAYS = 3;

/**
 * Start date for a journal's Crossref query: `firstFetchDays` back on its
 * first fetch, otherwise from the last successful fetch minus the overlap.
 */
export function sinceDate(
  fetchedThrough: string | undefined,
  today: Date,
  firstFetchDays: number,
): string {
  if (!fetchedThrough) return daysBefore(today, firstFetchDays);
  return daysBefore(fetchedThrough, OVERLAP_DAYS);
}

export interface Selection {
  write: StoredItem[];
  /** Matches held back by the per-run limit; they are written on a later run. */
  waiting: number;
}

/**
 * Which stored items to put into the Radar collection now: High/Possible,
 * not excluded, never written before, not already in the library, not a
 * first-fetch feed baseline, and first seen within `windowDays`. High first,
 * then by points. Re-evaluated every run, so items held back by the limit,
 * or lifted by a rule change, still get their turn.
 */
export function selectToWrite(
  stored: StoredItem[],
  opts: { now: Date; windowDays: number; max: number },
): Selection {
  const cutoff = opts.now.getTime() - opts.windowDays * DAY;
  const candidates = stored
    .filter(
      (s) =>
        !s.link &&
        !s.baseline &&
        !s.inLibrary &&
        s.score &&
        !s.score.excluded &&
        s.score.tier !== "rest" &&
        Date.parse(s.firstSeen) >= cutoff,
    )
    .sort(
      (a, b) =>
        Number(b.score!.tier === "high") - Number(a.score!.tier === "high") ||
        b.score!.total - a.score!.total ||
        b.firstSeen.localeCompare(a.firstSeen),
    );
  return {
    write: candidates.slice(0, opts.max),
    waiting: Math.max(0, candidates.length - opts.max),
  };
}

export interface RunSummary {
  journals: number;
  fetched: number;
  newItems: number;
  written: { high: number; possible: number; titleOnly: number };
  waiting: number;
  alreadyInLibrary: number;
  cleanedUp: number;
  errors: Array<{ journal: string; message: string }>;
}

export function emptySummary(): RunSummary {
  return {
    journals: 0,
    fetched: 0,
    newItems: 0,
    written: { high: 0, possible: 0, titleOnly: 0 },
    waiting: 0,
    alreadyInLibrary: 0,
    cleanedUp: 0,
    errors: [],
  };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Lines for the pop-up after a fetch. */
export function summaryLines(s: RunSummary, maxNewPerRun: number): string[] {
  const lines: string[] = [];
  const { high, possible, titleOnly } = s.written;
  if (high + possible === 0)
    lines.push(
      `No new matches (${plural(s.newItems, "new article")} checked in ${plural(s.journals, "journal")}).`,
    );
  else {
    lines.push(
      `${high} new High, ${possible} Possible${titleOnly ? ` (${titleOnly} title-only)` : ""}.`,
    );
  }
  if (s.waiting)
    lines.push(`${s.waiting} more waiting (limit ${maxNewPerRun} per fetch).`);
  if (s.alreadyInLibrary)
    lines.push(
      `${plural(s.alreadyInLibrary, "match", "matches")} already in your library, skipped.`,
    );
  if (s.cleanedUp)
    lines.push(
      `${plural(s.cleanedUp, "old untouched item")} moved to the Trash.`,
    );
  if (s.errors.length)
    lines.push(
      `${plural(s.errors.length, "journal")} failed: ${s.errors
        .slice(0, 3)
        .map((e) => `${e.journal} (${e.message})`)
        .join(", ")}${s.errors.length > 3 ? ", …" : ""}`,
    );
  return lines;
}

/** Run async tasks with at most `limit` in flight; results keep input order. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}
