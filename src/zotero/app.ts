import { Store } from "../core/store";
import { openZoteroDb } from "./db";
import { isRunning, removeActiveRadarItems, runFetch } from "./fetchRun";
import { registerNotifier, unregisterNotifier } from "./notifier";
import { startScheduler, stopScheduler } from "./scheduler";
import { loadSettings } from "./settings";

let store: Store | null = null;
let closeDb: (() => Promise<void>) | null = null;
let notifierID: string | undefined;
let menuID: string | false = false;
let startError: string | null = null;

const TITLE = "Research Radar";

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

  /** Replace the text with the result lines, then close after `closeMs` (-1 = stay until clicked). */
  finish(lines: string[], type: LineType, closeMs: number): void {
    try {
      if (!this.win) return;
      this.win.changeLine({ text: lines[0], type, progress: 100 });
      for (const line of lines.slice(1)) this.win.addDescription(line);
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
        l10nID: "researchradar-menuitem-remove-all",
        onCommand: () => void removeAll(),
      },
    ],
  });
  startScheduler(() => void fetchNow({ quietIfNothing: true }));
}

export async function stopApp(): Promise<void> {
  stopScheduler();
  unregisterNotifier(notifierID);
  if (menuID) Zotero.MenuManager.unregisterMenu(menuID);
  await closeDb?.().catch(() => undefined);
  store = null;
}

export async function fetchNow(
  opts: { quietIfNothing?: boolean } = {},
): Promise<void> {
  if (!store) {
    popup(
      [
        `Could not open the Research Radar database: ${startError ?? "unknown error"}`,
      ],
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
      popup(["No journals yet: add some in Settings → Research Radar."]);
    return;
  }
  const progress = opts.quietIfNothing
    ? null
    : new Popup(`Fetching ${journals.length} journals…`);
  try {
    const result = await runFetch(store);
    if (!result) return;
    const { summary, lines } = result;
    Zotero.debug(`[Research Radar] fetch done: ${JSON.stringify(summary)}`);
    const found = summary.written.high + summary.written.possible;
    const type: LineType =
      found > 0 ? "success" : summary.errors.length ? "fail" : "default";
    // Matches stay on screen until clicked; "nothing new" closes by itself
    const closeMs = found > 0 ? -1 : 10000;
    if (progress) progress.finish(lines, type, closeMs);
    else if (found > 0 || summary.errors.length) popup(lines, type, closeMs);
  } catch (e: any) {
    Zotero.logError(e);
    const msg = [`Fetch failed: ${e?.message ?? e}`];
    if (progress) progress.finish(msg, "fail", -1);
    else popup(msg, "fail", -1);
  }
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
  popup(
    [`${n} Radar item${n === 1 ? "" : "s"} moved to the Trash.`],
    "success",
  );
}
