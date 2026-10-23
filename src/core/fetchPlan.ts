import { AI_LIFT_MIN, effectiveTier } from "./ai";
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

/** Can this article be written to Radar again? Never written, or tidied away and now matching again. */
const writable = (s: StoredItem) => !s.link || s.link.status === "tidied";

/**
 * Does an article belong in Radar under the current settings? New articles:
 * High or Possible after the AI's say. Articles from the initial search:
 * only High, or rated 2-3 by the AI (with the current interests and model),
 * so Radar/Earlier holds the strongest of the backlog. Never if excluded.
 */
export function qualifies(s: StoredItem, aiContext: string | null): boolean {
  if (!s.score || s.score.excluded) return false;
  if (s.earlier)
    return (
      s.score.tier === "high" ||
      (aiContext !== null &&
        s.ai?.context === aiContext &&
        s.ai.score >= AI_LIFT_MIN)
    );
  return effectiveTier(s.score, s.ai, aiContext).tier !== "rest";
}

/** Strongest first: High, then points, then AI rating, then newest. */
function byStrength(aiContext: string | null) {
  const tierOf = (s: StoredItem) =>
    effectiveTier(s.score!, s.ai, aiContext).tier;
  return (a: StoredItem, b: StoredItem) =>
    Number(tierOf(b) === "high") - Number(tierOf(a) === "high") ||
    b.score!.total - a.score!.total ||
    (b.ai?.score ?? 0) - (a.ai?.score ?? 0) ||
    b.firstSeen.localeCompare(a.firstSeen);
}

/**
 * Which new articles to put into Radar/High and Radar/Possible now: matching,
 * not written before, not already in the library, not a first-fetch feed
 * baseline, not from the initial search, and first seen within
 * `windowDays`. Strongest first. Re-evaluated every run, so items held back
 * by the limit, or lifted by a rule change, still get their turn.
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
  const ctx = opts.aiContext ?? null;
  const cutoff = opts.now.getTime() - opts.windowDays * DAY;
  const candidates = stored
    .filter(
      (s) =>
        writable(s) &&
        !s.earlier &&
        !s.baseline &&
        !s.inLibrary &&
        qualifies(s, ctx) &&
        Date.parse(s.firstSeen) >= cutoff,
    )
    .sort(byStrength(ctx));
  return {
    write: candidates.slice(0, opts.max),
    waiting: Math.max(0, candidates.length - opts.max),
  };
}

/** Which articles from the initial search to put into Radar/Earlier now. Strongest first. */
export function selectEarlierToWrite(
  stored: StoredItem[],
  opts: { max: number; aiContext: string | null },
): Selection {
  const candidates = stored
    .filter(
      (s) =>
        s.earlier &&
        writable(s) &&
        !s.inLibrary &&
        qualifies(s, opts.aiContext),
    )
    .sort(byStrength(opts.aiContext));
  return {
    write: candidates.slice(0, opts.max),
    waiting: Math.max(0, candidates.length - opts.max),
  };
}

/**
 * Untouched Radar items that no longer belong there, e.g. after a rule was
 * deleted. The caller still checks each one in Zotero: anything the user
 * filed, annotated or gave an attachment is kept.
 */
export function selectToTidy(
  stored: StoredItem[],
  aiContext: string | null,
): StoredItem[] {
  return stored.filter(
    (s) => s.link?.status === "active" && !qualifies(s, aiContext),
  );
}

/**
 * Which articles to send to the AI this run, without a judgement for the
 * current interests and model, not in the library and not excluded. In
 * order: recent articles not in Radar (the AI can lift them), then initial
 * search articles that matched a keyword rule (the AI decides which go to
 * Radar/Earlier), then articles already in Radar. Newest first in each
 * group, at most `max`. The rest of the initial search is not sent: rating
 * thousands of articles would take too long and cost too much.
 */
export function selectForAi(
  stored: StoredItem[],
  opts: { now: Date; windowDays: number; context: string; max: number },
): StoredItem[] {
  const cutoff = opts.now.getTime() - opts.windowDays * DAY;
  const group = (s: StoredItem): number | null => {
    if (s.inLibrary || s.baseline || s.score?.excluded) return null;
    if (s.ai?.context === opts.context) return null;
    if (s.link?.status === "active") return 2;
    if (!writable(s)) return null;
    if (s.earlier) return s.score && s.score.tier !== "rest" ? 1 : null;
    return Date.parse(s.firstSeen) >= cutoff ? 0 : null;
  };
  return stored
    .map((s) => ({ s, g: group(s) }))
    .filter((x): x is { s: StoredItem; g: number } => x.g !== null)
    .sort((a, b) => a.g - b.g || b.s.firstSeen.localeCompare(a.s.firstSeen))
    .slice(0, opts.max)
    .map((x) => x.s);
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
  /** Untouched Radar items trashed because they no longer match. */
  tidied?: number;
  /**
   * Initial search: `fromYear` and `found` only on the run that searched;
   * `written` and `waiting` on every run that has earlier articles to file.
   */
  earlier?: {
    fromYear?: number;
    found?: number;
    written: number;
    waiting: number;
  };
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
  const e = s.earlier;
  if (e?.fromYear !== undefined)
    lines.push(`Since ${e.fromYear}: ${e.found ?? 0} earlier articles`);
  if (high + possible === 0) lines.push("No new matches");
  else lines.push(`${high} High, ${possible} Possible added`);
  if (titleOnly) lines.push(`${titleOnly} of them title-only`);
  if (s.written.byAi) lines.push(`${s.written.byAi} of them found by AI`);
  if (e?.written) lines.push(`${e.written} added to Radar/Earlier`);
  if (s.ai.judged) lines.push(aiRatedLine(s.ai.judged, s.ai.relevant ?? 0));
  if (s.waiting) lines.push(`${s.waiting} more next time (per-fetch limit)`);
  if (e?.waiting) lines.push(`${e.waiting} earlier ones next time`);
  if (s.alreadyInLibrary)
    lines.push(`${s.alreadyInLibrary} already in your library`);
  if (s.cleanedUp) lines.push(`${s.cleanedUp} old items moved to Trash`);
  if (s.tidied) lines.push(`${s.tidied} no longer matching: to Trash`);
  if (s.errors.length)
    lines.push(`${plural(s.errors.length, "journal")} failed: see Settings`);
  return lines;
}

/** Full result lines, kept for the settings pane. */
export function summaryLines(s: RunSummary, maxNewPerRun: number): string[] {
  const lines: string[] = [];
  const { high, possible, titleOnly } = s.written;
  const e = s.earlier;
  if (e?.fromYear !== undefined)
    lines.push(
      `Initial search: ${plural(e.found ?? 0, "earlier article")} since ${e.fromYear} added to All fetched articles.`,
    );
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
  if (e?.written)
    lines.push(
      `${plural(e.written, "earlier article")} added to Radar/Earlier.`,
    );
  if (s.ai.judged)
    lines.push(`${aiRatedLine(s.ai.judged, s.ai.relevant ?? 0)}.`);
  if (s.ai.skipped) lines.push(`AI not used: ${s.ai.skipped}`);
  if (s.waiting)
    lines.push(`${s.waiting} more waiting (limit ${maxNewPerRun} per fetch).`);
  if (e?.waiting)
    lines.push(
      `${plural(e.waiting, "earlier article")} for Radar/Earlier waiting for the next fetches.`,
    );
  if (s.alreadyInLibrary)
    lines.push(
      `${plural(s.alreadyInLibrary, "match", "matches")} already in your library, skipped.`,
    );
  if (s.cleanedUp)
    lines.push(
      `${plural(s.cleanedUp, "old untouched item")} moved to the Trash.`,
    );
  if (s.tidied)
    lines.push(
      `${plural(s.tidied, "untouched Radar item")} no longer matching your settings, moved to the Trash.`,
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
