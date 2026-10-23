import { effectiveTier } from "./ai";
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
  opts: {
    now: Date;
    windowDays: number;
    max: number;
    /** Current AI context, or null when AI is off: only current AI 2s and 3s lift. */
    aiContext?: string | null;
  },
): Selection {
  const cutoff = opts.now.getTime() - opts.windowDays * DAY;
  const tierOf = (s: StoredItem) =>
    effectiveTier(s.score!, s.ai, opts.aiContext ?? null).tier;
  const candidates = stored
    .filter(
      (s) =>
        !s.link &&
        !s.baseline &&
        !s.inLibrary &&
        s.score &&
        !s.score.excluded &&
        tierOf(s) !== "rest" &&
        Date.parse(s.firstSeen) >= cutoff,
    )
    .sort(
      (a, b) =>
        Number(tierOf(b) === "high") - Number(tierOf(a) === "high") ||
        b.score!.total - a.score!.total ||
        (b.ai?.score ?? 0) - (a.ai?.score ?? 0) ||
        b.firstSeen.localeCompare(a.firstSeen),
    );
  return {
    write: candidates.slice(0, opts.max),
    waiting: Math.max(0, candidates.length - opts.max),
  };
}

/**
 * Which articles to send to the AI this run: recent, not yet in the library
 * (Radar items still count), not excluded by a rule, and without a judgement
 * for the current interests and model. Articles not in Radar come first,
 * because only they can be lifted; then newest first, at most `max`.
 */
export function selectForAi(
  stored: StoredItem[],
  opts: { now: Date; windowDays: number; context: string; max: number },
): StoredItem[] {
  const cutoff = opts.now.getTime() - opts.windowDays * DAY;
  return stored
    .filter(
      (s) =>
        (!s.link || s.link.status === "active") &&
        !s.baseline &&
        !s.inLibrary &&
        !s.score?.excluded &&
        s.ai?.context !== opts.context &&
        Date.parse(s.firstSeen) >= cutoff,
    )
    .sort(
      (a, b) =>
        Number(!!a.link) - Number(!!b.link) ||
        b.firstSeen.localeCompare(a.firstSeen),
    )
    .slice(0, opts.max);
}

export interface RunSummary {
  journals: number;
  fetched: number;
  newItems: number;
  written: { high: number; possible: number; titleOnly: number; byAi: number };
  waiting: number;
  /**
   * AI judgements made this run, and how many of them scored 2 or 3;
   * `skipped` explains why the AI was not (fully) used.
   */
  ai: { judged: number; relevant?: number; skipped?: string };
  alreadyInLibrary: number;
  cleanedUp: number;
  errors: Array<{ journal: string; message: string }>;
}

export function emptySummary(): RunSummary {
  return {
    journals: 0,
    fetched: 0,
    newItems: 0,
    written: { high: 0, possible: 0, titleOnly: 0, byAi: 0 },
    waiting: 0,
    ai: { judged: 0 },
    alreadyInLibrary: 0,
    cleanedUp: 0,
    errors: [],
  };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "AI rated 50: 8 relevant", short enough for the pop-up. */
function aiRatedLine(judged: number, relevant: number): string {
  return `AI rated ${judged}: ${relevant || "none"} relevant (2–3/3)`;
}

/** Zotero's pop-up fits about this many characters per line. */
export const POPUP_LINE_MAX = 40;

/**
 * Short lines for the pop-up. Details (which journal failed and why) go in
 * summaryLines, shown in the settings pane.
 */
export function popupLines(s: RunSummary): string[] {
  const { high, possible, titleOnly } = s.written;
  const lines: string[] = [];
  if (high + possible === 0) lines.push("No new matches");
  else lines.push(`${high} High, ${possible} Possible added`);
  if (titleOnly) lines.push(`${titleOnly} of them title-only`);
  if (s.written.byAi) lines.push(`${s.written.byAi} of them found by AI`);
  if (s.ai.judged) lines.push(aiRatedLine(s.ai.judged, s.ai.relevant ?? 0));
  if (s.waiting) lines.push(`${s.waiting} more next time (per-fetch limit)`);
  if (s.alreadyInLibrary)
    lines.push(`${s.alreadyInLibrary} already in your library`);
  if (s.cleanedUp) lines.push(`${s.cleanedUp} old items moved to Trash`);
  if (s.errors.length)
    lines.push(`${plural(s.errors.length, "journal")} failed: see Settings`);
  return lines;
}

/** Full result lines, kept for the settings pane. */
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
  if (s.written.byAi)
    lines.push(
      `${plural(s.written.byAi, "article")} found by AI (no keyword rule matched).`,
    );
  if (s.ai.judged)
    lines.push(`${aiRatedLine(s.ai.judged, s.ai.relevant ?? 0)}.`);
  if (s.ai.skipped) lines.push(`AI not used: ${s.ai.skipped}`);
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
