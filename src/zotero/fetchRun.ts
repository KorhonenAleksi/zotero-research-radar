import { buildWorksUrl, mapWorks } from "../core/crossref";
import { parseFeed } from "../core/feed";
import {
  emptySummary,
  isoDay,
  mapPool,
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
import { loadSettings } from "./settings";

const DAY = 24 * 60 * 60 * 1000;
const CROSSREF_ROWS = 200;
const CONCURRENCY = 3;

let running = false;

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

/** Trash old untouched Radar items; mark ones the user filed or annotated as kept. */
async function cleanup(
  store: Store,
  cleanupDays: number,
  collections: Awaited<ReturnType<typeof ensureCollections>>,
): Promise<number> {
  if (cleanupDays <= 0) return 0;
  const cutoff = Date.now() - cleanupDays * DAY;
  let trashed = 0;
  for (const link of await store.linksByStatus("active")) {
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

/** One complete fetch. Returns null if a fetch is already running. */
export async function runFetch(
  store: Store,
): Promise<{ summary: RunSummary; lines: string[] } | null> {
  if (running) return null;
  running = true;
  const summary = emptySummary();
  const runId = await store.startRun();
  try {
    const { general, journals, scoring, warnings } = loadSettings();
    for (const w of warnings) ztoolkit.log(`settings: ${w}`);
    const now = new Date();
    const today = isoDay(now);
    const collections = await ensureCollections();

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

    // Re-score everything stored, so rule changes apply to recent items too
    const compiled = compileScoring(scoring);
    let stored = await store.allItems();
    await store.saveScores(
      stored.map((s) => ({
        key: s.item.key,
        score: scoreItem(s.item, compiled),
      })),
    );
    stored = await store.allItems();

    const windowDays = Math.max(general.firstFetchDays, 7);
    const candidates = selectToWrite(stored, {
      now,
      windowDays,
      max: Number.MAX_SAFE_INTEGER,
    }).write;
    let written = 0;
    for (const s of candidates) {
      if (written >= general.maxNewPerRun) {
        summary.waiting++;
        continue;
      }
      if (s.item.doi && (await libraryHasDoi(s.item.doi))) {
        await store.markInLibrary(s.item.key);
        summary.alreadyInLibrary++;
        continue;
      }
      const tier = s.score!.tier as "high" | "possible";
      const itemID = await createRadarItem(
        s.item,
        s.score!,
        tier,
        collections,
        today,
      );
      await store.addLink(s.item.key, userLibraryID(), itemID, tier);
      written++;
      summary.written[tier]++;
      if (s.item.titleOnly) summary.written.titleOnly++;
    }
    const lines = summaryLines(summary, general.maxNewPerRun);
    setPref("lastRun", now.toISOString());
    // Kept so a pop-up closed by another plugin never means a lost result
    setPref("lastRunSummary", JSON.stringify(lines));
    return { summary, lines: popupLines(summary) };
  } finally {
    await store.finishRun(runId, summary).catch(() => undefined);
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
  const collections = await ensureCollections();
  const itemID = await createRadarItem(
    s.item,
    score,
    tier,
    collections,
    isoDay(new Date()),
    true,
  );
  await store.addLink(s.item.key, userLibraryID(), itemID, tier);
  await store.setLinkStatus(s.item.key, "kept");
  return "added";
}
