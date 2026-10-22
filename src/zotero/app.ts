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

function popup(
  lines: string[],
  type: "success" | "default" | "fail" = "default",
  closeMs = 10000,
) {
  const win = new ztoolkit.ProgressWindow(TITLE, {
    closeOnClick: true,
    closeTime: closeMs,
  });
  for (const text of lines) win.createLine({ text, type });
  win.show();
  return win;
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
    : popup([`Fetching ${journals.length} journals…`], "default", -1);
  try {
    const result = await runFetch(store);
    progress?.close();
    if (!result) return;
    const { summary, lines } = result;
    const found = summary.written.high + summary.written.possible;
    if (opts.quietIfNothing && found === 0 && summary.errors.length === 0)
      return;
    popup(
      lines,
      found > 0 ? "success" : summary.errors.length ? "fail" : "default",
      found > 0 ? -1 : 10000,
    );
  } catch (e: any) {
    progress?.close();
    Zotero.logError(e);
    popup([`Fetch failed: ${e?.message ?? e}`], "fail");
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
