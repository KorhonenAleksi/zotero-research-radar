import { aiContext, effectiveTier } from "../core/ai";
import {
  buildEarlierWorksUrl,
  buildWorksUrl,
  mapWorks,
  nextCursor,
} from "../core/crossref";
import { parseFeed } from "../core/feed";
import {
  daysBefore,
  emptySummary,
  isoDay,
  mapPool,
  selectEarlierToWrite,
  selectForAi,
  selectToTidy,
  selectToWrite,
  sinceDate,
  popupLines,
  summaryLines,
  type RunSummary,
} from "../core/fetchPlan";
import { mergeItems } from "../core/merge";
import { compileScoring, scoreItem } from "../core/rules";
import type { Store, StoredItem } from "../core/store";
import type { Journal, RadarItem } from "../core/types";
import { setPref } from "../utils/prefs";
import { getJson, getText } from "./http";
import {
  cleanupVerdict,
  createRadarItem,
  ensureCollections,
  libraryHasDoi,
  trashItem,
  userLibraryID,
} from "./library";
import { judgeStoredItems } from "./ai";
import { shouldStop } from "./stopFlag";
import { aiNotReady, loadAiSettings, loadSettings } from "./settings";

const DAY = 24 * 60 * 60 * 1000;
const CROSSREF_ROWS = 200;
const CONCURRENCY = 3;
/** Initial search: Crossref's largest page, one journal at a time, and a safety stop. */
const EARLIER_ROWS = 1000;
const EARLIER_CONCURRENCY = 1;
const EARLIER_MAX_PAGES = 30;
/** A 1000-article page with abstracts can take a while. */
const EARLIER_TIMEOUT_MS = 90000;
/** At most this many initial-search articles are filed into Radar/Earlier per fetch. */
const EARLIER_PER_RUN = 50;

let running = false;

/** Wait until no fetch is running, at most `ms`. */
export async function waitUntilIdle(ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (running && Date.now() < until) await Zotero.Promise.delay(100);
}

/** New items are written in small groups with a pause between them, so
 * plugins that react to new items (citation counts, duplicate checks,
 * actions) are not hit by a burst. */
const WRITE_BATCH = 5;
const WRITE_PAUSE_MS = 2000;

export const isRunning = () => running;

interface JournalResult {
  journal: Journal;
  items: RadarItem[];
  firstFetch: boolean;
  ok: boolean;
  error?: string;
}

async function fetchJournal(
  journal: Journal,
  store: Store,
  today: Date,
  firstFetchDays: number,
  mailto: string,
): Promise<JournalResult> {
  const through = await store.journalFetchedThrough(journal.id);
  const firstFetch = !through;
  const errors: string[] = [];
  let crossref: RadarItem[] = [];
  let feed: RadarItem[] = [];
  let anyOk = false;

  if (journal.crossref && (journal.issnPrint || journal.issnElectronic)) {
    try {
      const url = buildWorksUrl(
        journal,
        sinceDate(through, today, firstFetchDays),
        {
          rows: CROSSREF_ROWS,
          mailto: mailto || undefined,
        },
      );
      const data = await getJson(url);
      crossref = mapWorks(data, journal);
      const total = (data as any)?.message?.["total-results"];
      if (typeof total === "number" && total > CROSSREF_ROWS)
        ztoolkit.log(
          `${journal.title}: ${total} results, only the newest ${CROSSREF_ROWS} fetched`,
        );
      anyOk = true;
    } catch (e: any) {
      errors.push(`Crossref: ${e.message}`);
    }
  }
  if (journal.feedUrl) {
    try {
      feed = parseFeed(await getText(journal.feedUrl), journal);
      anyOk = true;
    } catch (e: any) {
      errors.push(`feed: ${e.message}`);
    }
  }
  return {
    journal,
    items: mergeItems(crossref, feed),
    firstFetch,
    ok: anyOk,
    error: errors.length ? errors.join("; ") : undefined,
  };
}

/**
 * Initial search for one journal: every article published since `fromYear`
 * and registered up to `until`, page by page. Feeds only hold recent items,
 * so this is Crossref only; RSS-only journals are skipped.
 */
async function fetchJournalEarlier(
  journal: Journal,
  fromYear: number,
  until: string,
  mailto: string,
): Promise<{ journal: Journal; items: RadarItem[]; error?: string }> {
  if (!journal.crossref || !(journal.issnPrint || journal.issnElectronic))
    return { journal, items: [] };
  const items: RadarItem[] = [];
  let cursor: string | null = "*";
  try {
    for (let page = 0; cursor && page < EARLIER_MAX_PAGES; page++) {
      if (shouldStop()) break;
      const data = await getJson(
        buildEarlierWorksUrl(journal, fromYear, until, {
          rows: EARLIER_ROWS,
          cursor,
          mailto: mailto || undefined,
        }),
        EARLIER_TIMEOUT_MS,
      );
      items.push(...mapWorks(data, journal));
      cursor = nextCursor(data, EARLIER_ROWS);
    }
    return { journal, items };
  } catch (e: any) {
    return { journal, items, error: `initial search: ${e.message}` };
  }
}

/** Trash old untouched Radar items; mark ones the user filed or annotated as kept. */
async function cleanup(
  store: Store,
  cleanupDays: number,
  collections: Awaited<ReturnType<typeof ensureCollections>>,
): Promise<number> {
  if (cleanupDays <= 0) return 0;
  const cutoff = Date.now() - cleanupDays * DAY;
  // Radar/Earlier is not cleaned up by age: those articles are old by design
  const earlier = await store.earlierKeys();
  let trashed = 0;
  for (const link of await store.linksByStatus("active")) {
    if (earlier.has(link.key)) continue;
    if (Date.parse(link.createdAt) > cutoff) continue;
    const verdict = cleanupVerdict(link.zoteroItemId, collections);
    if (verdict === "kept") await store.setLinkStatus(link.key, "kept");
    else if (verdict === "gone")
      await store.setLinkStatus(link.key, "dismissed");
    else {
      // Mark first, so the notifier doesn't record our own trashing as a dismissal
      await store.setLinkStatus(link.key, "expired");
      await trashItem(link.zoteroItemId);
      trashed++;
    }
  }
  return trashed;
}

/**
 * Trash untouched Radar items that no longer match the settings (e.g. after
 * a rule was deleted). Kept ones are marked kept; nothing the user filed,
 * annotated or gave an attachment is touched.
 */
async function tidy(
  store: Store,
  stored: StoredItem[],
  aiContext: string | null,
  collections: Awaited<ReturnType<typeof ensureCollections>>,
): Promise<number> {
  let trashed = 0;
  for (const s of selectToTidy(stored, aiContext)) {
    if (shouldStop()) break;
    const link = s.link!;
    const verdict = cleanupVerdict(link.zoteroItemId, collections);
    if (verdict === "kept") await store.setLinkStatus(link.key, "kept");
    else if (verdict === "gone")
      await store.setLinkStatus(link.key, "dismissed");
    else {
      // Mark first, so the notifier doesn't record our own trashing as a dismissal
      await store.setLinkStatus(link.key, "tidied");
      await trashItem(link.zoteroItemId);
      trashed++;
    }
  }
  return trashed;
}

/**
 * One complete fetch. With `earlierFromYear`, it first runs the initial
 * search for older articles. Returns null if a fetch is already running.
 */
export async function runFetch(
  store: Store,
  opts: { earlierFromYear?: number } = {},
): Promise<{ summary: RunSummary; lines: string[] } | null> {
  if (running || shouldStop()) return null;
  running = true;
  const summary = emptySummary();
  const runId = await store.startRun();
  try {
    const { general, journals, warnings } = loadSettings();
    for (const w of warnings) ztoolkit.log(`settings: ${w}`);
    const now = new Date();
    const today = isoDay(now);
    const collections = await ensureCollections({
      earlier: opts.earlierFromYear !== undefined,
    });

    summary.cleanedUp = await cleanup(store, general.cleanupDays, collections);

    summary.journals = journals.length;
    const results = await mapPool(journals, CONCURRENCY, (j) =>
      fetchJournal(j, store, now, general.firstFetchDays, general.mailto),
    );

    for (const r of results) {
      if (r.error)
        summary.errors.push({ journal: r.journal.title, message: r.error });
      if (!r.ok) continue;
      summary.fetched += r.items.length;
      const upserted = await store.upsertItems(r.items, {
        // On a journal's first fetch, feed-only items are old backlog
        baseline: (item) => r.firstFetch && !item.sources.includes("crossref"),
      });
      summary.newItems += upserted.filter((u) => u.isNew).length;
      await store.recordJournalFetch(r.journal.id, { through: today });
    }
    for (const r of results)
      if (!r.ok && r.error)
        await store.recordJournalFetch(r.journal.id, { error: r.error });

    // Initial search: up to where the regular fetch's first look-back begins.
    // Articles the regular fetch already has keep counting as new.
    if (opts.earlierFromYear !== undefined) {
      const fromYear = opts.earlierFromYear;
      const until = daysBefore(today, general.firstFetchDays);
      let found = 0;
      const earlierResults = await mapPool(journals, EARLIER_CONCURRENCY, (j) =>
        fetchJournalEarlier(j, fromYear, until, general.mailto),
      );
      for (const r of earlierResults) {
        if (r.error)
          summary.errors.push({ journal: r.journal.title, message: r.error });
        const upserted = await store.upsertItems(r.items, { earlier: true });
        found += upserted.filter((u) => u.isNew).length;
      }
      summary.earlier = { fromYear, found, written: 0, waiting: 0 };
    }

    // Re-score everything stored, so rule changes apply to recent items too
    let stored = await rescoreAll(store);
    const windowDays = Math.max(general.firstFetchDays, 7);

    // Optional AI judgements. Any problem means a silent fallback to the
    // rule scores; the reason is shown under "Last fetch" in Settings.
    const { ai, interests } = loadAiSettings();
    let currentAiContext: string | null = null;
    // AI finds are not tidied away just because the AI is switched off
    // for a while; only a change of interests or model makes them outdated
    const keepAiContext =
      ai.model && interests ? aiContext(interests, ai.model) : null;
    if (ai.enabled) {
      const notReady = aiNotReady(ai, interests);
      if (notReady) summary.ai.skipped = notReady;
      else {
        currentAiContext = aiContext(interests, ai.model);
        const toJudge = selectForAi(stored, {
          now,
          windowDays,
          context: currentAiContext,
          max: ai.maxPerRun,
        });
        summary.ai = await judgeStoredItems(store, toJudge, interests, ai);
        stored = await store.allItems();
      }
    }

    // Not when some settings could not be read: a damaged rule list would
    // otherwise make every Radar item look unmatched
    if (warnings.length === 0) {
      summary.tidied = await tidy(store, stored, keepAiContext, collections);
      if (summary.tidied) stored = await store.allItems();
    }

    const candidates = selectToWrite(stored, {
      now,
      windowDays,
      max: Number.MAX_SAFE_INTEGER,
      aiContext: currentAiContext,
    }).write;
    let written = 0;
    for (const s of candidates) {
      if (shouldStop()) break;
      if (written > 0 && written % WRITE_BATCH === 0)
        await Zotero.Promise.delay(WRITE_PAUSE_MS);
      if (written >= general.maxNewPerRun) {
        summary.waiting++;
        continue;
      }
      if (s.item.doi && (await libraryHasDoi(s.item.doi))) {
        await store.markInLibrary(s.item.key);
        summary.alreadyInLibrary++;
        continue;
      }
      const eff = effectiveTier(s.score!, s.ai, currentAiContext);
      const tier = eff.tier as "high" | "possible";
      const itemID = await createRadarItem(
        s.item,
        s.score!,
        tier,
        collections,
        today,
        { ai: currentAiContext ? s.ai : undefined, liftedByAi: eff.liftedByAi },
      );
      await store.addLink(s.item.key, userLibraryID(), itemID, tier);
      written++;
      summary.written[tier]++;
      if (eff.liftedByAi) summary.written.byAi++;
      if (s.item.titleOnly) summary.written.titleOnly++;
    }

    // Initial search articles, a limited number per fetch
    const earlier = selectEarlierToWrite(stored, {
      max: EARLIER_PER_RUN,
      aiContext: currentAiContext,
    });
    if (earlier.write.length || summary.earlier) {
      summary.earlier ??= { written: 0, waiting: 0 };
      summary.earlier.waiting = earlier.waiting;
      const withEarlier = collections.earlier
        ? collections
        : await ensureCollections({ earlier: true });
      for (const s of earlier.write) {
        if (shouldStop()) break;
        if (written > 0 && written % WRITE_BATCH === 0)
          await Zotero.Promise.delay(WRITE_PAUSE_MS);
        if (s.item.doi && (await libraryHasDoi(s.item.doi))) {
          await store.markInLibrary(s.item.key);
          summary.alreadyInLibrary++;
          continue;
        }
        const tier = s.score!.tier === "high" ? "high" : "possible";
        const itemID = await createRadarItem(
          s.item,
          s.score!,
          tier,
          withEarlier,
          today,
          { ai: currentAiContext ? s.ai : undefined, earlier: true },
        );
        await store.addLink(s.item.key, userLibraryID(), itemID, tier);
        written++;
        summary.earlier.written++;
      }
    }
    const lines = summaryLines(summary, general.maxNewPerRun);
    setPref("lastRun", now.toISOString());
    // Kept so a pop-up closed by another plugin never means a lost result
    setPref("lastRunSummary", JSON.stringify(lines));
    return { summary, lines: popupLines(summary) };
  } finally {
    await store.finishRun(runId, summary).catch(() => undefined);
    // Fold the database's change log back into the main file
    await store.checkpoint().catch(() => undefined);
    running = false;
  }
}

/** Move every untouched Radar item to the Trash. Items the user kept are left alone. */
export async function removeActiveRadarItems(store: Store): Promise<number> {
  const collections = await ensureCollections();
  let n = 0;
  for (const link of await store.linksByStatus("active")) {
    const verdict = cleanupVerdict(link.zoteroItemId, collections);
    if (verdict === "kept") {
      await store.setLinkStatus(link.key, "kept");
      continue;
    }
    await store.setLinkStatus(link.key, "removed");
    if (verdict === "trash") {
      await trashItem(link.zoteroItemId);
      n++;
    }
  }
  return n;
}

/**
 * "Add to Radar" from the All fetched articles window. The user chose the
 * article, so it counts as kept at once and cleanup never trashes it.
 */
export async function addToRadarByHand(
  store: Store,
  s: StoredItem,
): Promise<"added" | "inLibrary"> {
  if (s.item.doi && (await libraryHasDoi(s.item.doi))) {
    await store.markInLibrary(s.item.key);
    return "inLibrary";
  }
  const score =
    s.score ?? scoreItem(s.item, compileScoring(loadSettings().scoring));
  const tier = score.tier === "high" ? "high" : "possible";
  const collections = await ensureCollections({ earlier: s.earlier });
  const itemID = await createRadarItem(
    s.item,
    score,
    tier,
    collections,
    isoDay(new Date()),
    { addedByHand: true, ai: s.ai, earlier: s.earlier },
  );
  await store.addLink(s.item.key, userLibraryID(), itemID, tier);
  await store.setLinkStatus(s.item.key, "kept");
  return "added";
}

/**
 * Re-score every stored article with the current settings; returns them.
 * Only changed scores are written, which matters once the initial search
 * has filled the store with thousands of articles.
 */
export async function rescoreAll(store: Store): Promise<StoredItem[]> {
  const compiled = compileScoring(loadSettings().scoring);
  const stored = await store.allItems();
  const changed = stored
    .map((s) => ({ s, score: scoreItem(s.item, compiled) }))
    .filter(({ s, score }) => JSON.stringify(score) !== JSON.stringify(s.score))
    .map(({ s, score }) => ({ key: s.item.key, score }));
  if (changed.length === 0) return stored;
  await store.saveScores(changed);
  return store.allItems();
}
