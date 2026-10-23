import { Store } from "../core/store";
import {
  closeAllItems,
  openAllItems,
  refreshAllItems,
  type RowActionHandler,
} from "./allItemsWindow";
import { openZoteroDb } from "./db";
import {
  isRunning,
  removeActiveRadarItems,
  waitUntilIdle,
  rescoreAll,
  runFetch,
} from "./fetchRun";
import { getPref, setPref } from "../utils/prefs";
import { repairEscapedPublicationTitles } from "./library";
import { registerNotifier, unregisterNotifier } from "./notifier";
import { requestStop } from "./stopFlag";
import {
  followJournal,
  infoFromRadarItem,
  infoFromZoteroItem,
  ruleFromArticle,
  watchAuthor,
  type ActionHooks,
  type ArticleInfo,
} from "./quickActions";
import { startScheduler, stopScheduler } from "./scheduler";
import { loadSettings } from "./settings";

let store: Store | null = null;
let closeDb: (() => Promise<void>) | null = null;
let notifierID: string | undefined;
let menuID: string | false = false;
let itemMenuID: string | false = false;
let startError: string | null = null;

const TITLE = "Research Radar";
const RESULT_POPUP_DELAY_MS = 3000;

type LineType = "success" | "default" | "fail";

/**
 * A Zotero pop-up that is opened once and updated in place. Closing one
 * pop-up and opening another in quick succession can lose the second, so a
 * fetch shows "Fetching…" and then rewrites the same window with the result.
 * Pop-up failures are logged, never thrown: they must not break a fetch.
 */
class Popup {
  private win: any = null;

  constructor(first: string, type: LineType = "default") {
    try {
      this.win = new ztoolkit.ProgressWindow(TITLE, {
        closeOnClick: true,
        closeTime: -1,
      })
        .createLine({ text: first, type })
        .show();
    } catch (e) {
      Zotero.debug(`[Research Radar] pop-up failed: ${e}`);
    }
  }

  close(): void {
    try {
      this.win?.close();
    } catch (e) {
      Zotero.debug(`[Research Radar] pop-up failed: ${e}`);
    }
    this.win = null;
  }

  /** Replace the text with the result lines, then close after `closeMs` (-1 = stay until clicked). */
  finish(lines: string[], type: LineType, closeMs: number): void {
    try {
      if (!this.win) return;
      // One short line per row; descriptions wrap badly in Zotero's narrow pop-up
      this.win.changeLine({ text: lines[0], type, progress: 100 });
      for (const text of lines.slice(1)) this.win.createLine({ text });
      if (closeMs > 0) this.win.startCloseTimer(closeMs);
    } catch (e) {
      Zotero.debug(`[Research Radar] pop-up failed: ${e}`);
    }
  }
}

function popup(
  lines: string[],
  type: LineType = "default",
  closeMs = 10000,
): void {
  new Popup(lines[0], type).finish(lines, type, closeMs);
}

export async function startApp(): Promise<void> {
  try {
    const opened = openZoteroDb();
    closeDb = opened.close;
    const s = new Store(opened.db);
    await s.init();
    store = s;
    notifierID = registerNotifier(s);
    if (!getPref("repairedEscapedTitles")) {
      const n = await repairEscapedPublicationTitles(
        await s.ownedZoteroItemIds(),
      );
      if (n) Zotero.debug(`[Research Radar] repaired ${n} journal names`);
      setPref("repairedEscapedTitles", true);
    }
  } catch (e: any) {
    startError = e?.message ?? String(e);
    Zotero.logError(e);
  }
  menuID = Zotero.MenuManager.registerMenu({
    menuID: "researchradar-tools",
    pluginID: addon.data.config.addonID,
    target: "main/menubar/tools",
    menus: [
      { menuType: "separator" },
      {
        menuType: "menuitem",
        l10nID: "researchradar-menuitem-fetch-now",
        onCommand: () => void fetchNow(),
      },
      {
        menuType: "menuitem",
        l10nID: "researchradar-menuitem-all-items",
        onCommand: () => {
          if (store) openAllItems(store, onRowAction);
          else
            popup(["Database could not be opened", startError ?? ""], "fail");
        },
      },
      {
        menuType: "menuitem",
        l10nID: "researchradar-menuitem-remove-all",
        onCommand: () => void removeAll(),
      },
    ],
  });
  // Right-click on an item in the main library: build settings from it
  itemMenuID = Zotero.MenuManager.registerMenu({
    menuID: "researchradar-item",
    pluginID: addon.data.config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        l10nID: "researchradar-menu-item",
        onShowing: (_e, ctx) =>
          ctx.setVisible(
            ctx.items?.length === 1 && !!ctx.items[0].isRegularItem(),
          ),
        menus: [
          {
            menuType: "menuitem",
            l10nID: "researchradar-menuitem-watch-author",
            onCommand: (_e, ctx) => void onItemAction("author", ctx.items?.[0]),
          },
          {
            menuType: "menuitem",
            l10nID: "researchradar-menuitem-follow-journal",
            onCommand: (_e, ctx) =>
              void onItemAction("journal", ctx.items?.[0]),
          },
          {
            menuType: "menuitem",
            l10nID: "researchradar-menuitem-make-rule",
            onCommand: (_e, ctx) => void onItemAction("rule", ctx.items?.[0]),
          },
        ],
      },
    ],
  });
  startScheduler(() => void fetchNow({ quietIfNothing: true }));
  // Plugins get no shutdown call when Zotero quits; this runs before Zotero
  // closes its databases, so ours is closed cleanly too
  Zotero.addShutdownListener(() => stopApp());
}

let stopped = false;

/**
 * Stop everything and close the plugin's database. Runs when the plugin is
 * disabled or updated, and also when Zotero quits (via a shutdown listener,
 * because plugins get no shutdown call on quit). Safe to call twice.
 */
export async function stopApp(): Promise<void> {
  if (stopped) return;
  stopped = true;
  stopScheduler();
  requestStop();
  await waitUntilIdle(5000);
  try {
    closeAllItems();
    unregisterNotifier(notifierID);
    notifierID = undefined;
    if (menuID) Zotero.MenuManager.unregisterMenu(menuID);
    if (itemMenuID) Zotero.MenuManager.unregisterMenu(itemMenuID);
  } catch (e) {
    Zotero.debug(`[Research Radar] cleanup: ${e}`);
  }
  await store?.checkpoint().catch(() => undefined);
  await closeDb?.().catch(() => undefined);
  closeDb = null;
  store = null;
}

export async function fetchNow(
  opts: { quietIfNothing?: boolean; earlierFromYear?: number } = {},
): Promise<void> {
  if (!store) {
    popup(
      ["Database could not be opened", startError ?? "unknown error"],
      "fail",
    );
    return;
  }
  if (isRunning()) {
    popup(["A fetch is already running."]);
    return;
  }
  const { journals } = loadSettings();
  if (journals.length === 0) {
    if (!opts.quietIfNothing)
      popup(["No journals yet:", "add them in Settings"]);
    return;
  }
  const progress = opts.quietIfNothing
    ? null
    : new Popup(
        opts.earlierFromYear !== undefined
          ? `Searching since ${opts.earlierFromYear}: takes minutes…`
          : `Fetching ${journals.length} journals…`,
      );
  try {
    const result = await runFetch(store, {
      earlierFromYear: opts.earlierFromYear,
    });
    if (!result) return;
    const { summary, lines } = result;
    Zotero.debug(`[Research Radar] fetch done: ${JSON.stringify(summary)}`);
    const found =
      summary.written.high +
      summary.written.possible +
      (summary.earlier?.written ?? 0);
    const type: LineType =
      found > 0 ? "success" : summary.errors.length ? "fail" : "default";
    // Matches stay on screen until clicked; "nothing new" closes by itself
    const closeMs = found > 0 ? -1 : 10000;
    if (found > 0) {
      // New items make other plugins react (Actions and Tags, Zoplicate…),
      // and some of them close every open pop-up. Show the result in a fresh
      // pop-up once they have had their turn.
      progress?.close();
      await Zotero.Promise.delay(RESULT_POPUP_DELAY_MS);
      popup(lines, type, closeMs);
    } else if (progress) progress.finish(lines, type, closeMs);
    else if (summary.errors.length) popup(lines, type, closeMs);
  } catch (e: any) {
    Zotero.logError(e);
    const msg = ["Fetch failed", String(e?.message ?? e)];
    if (progress) progress.finish(msg, "fail", -1);
    else popup(msg, "fail", -1);
  }
}

/** The initial search, started from the settings pane. */
export function runInitialSearch(fromYear: number): void {
  void fetchNow({ earlierFromYear: fromYear });
}

async function removeAll(): Promise<void> {
  if (!store) return;
  const win = Zotero.getMainWindow();
  const ok = Services.prompt.confirm(
    win as any,
    TITLE,
    "Move all untouched Radar items to the Trash?\n\nItems you have added to your own collections, or given notes or attachments, are kept. You can restore anything from the Trash.",
  );
  if (!ok) return;
  const n = await removeActiveRadarItems(store);
  popup([`${n} Radar item${n === 1 ? "" : "s"} moved to Trash`], "success");
}

const actionHooks: ActionHooks = {
  afterChange: async () => {
    if (store) await rescoreAll(store);
    await refreshAllItems();
  },
  notify: (lines, type = "default") => popup(lines, type),
};

async function runAction(
  action: "author" | "journal" | "rule",
  info: ArticleInfo,
  win?: Window,
): Promise<void> {
  try {
    if (action === "author") await watchAuthor(info, actionHooks, win);
    else if (action === "journal") await followJournal(info, actionHooks);
    else await ruleFromArticle(info, actionHooks, store, win);
  } catch (e: any) {
    Zotero.logError(e);
    popup(["Action failed", String(e?.message ?? e)], "fail");
  }
}

async function onItemAction(
  action: "author" | "journal" | "rule",
  item: Zotero.Item | undefined,
): Promise<void> {
  if (!item) return;
  await runAction(action, await infoFromZoteroItem(item, store));
}

const onRowAction: RowActionHandler = (action, s, win) =>
  runAction(action, infoFromRadarItem(s.item), win);
