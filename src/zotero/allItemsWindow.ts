import { summarize } from "../core/explain";
import {
  canAddToRadar,
  DEFAULT_FILTER,
  filterItems,
  journalOptions,
  statusLabel,
  tierCounts,
  type TierFilter,
  type ViewFilter,
} from "../core/itemsView";
import type { Store, StoredItem } from "../core/store";
import { isWindowAlive } from "../utils/window";
import { clear, h } from "./dom";
import { addToRadarByHand } from "./fetchRun";

const MAX_ROWS = 300;
const TIER_LABEL: Record<TierFilter, string> = {
  all: "All tiers",
  high: "High",
  possible: "Possible",
  rest: "Rest",
  excluded: "Excluded",
};

let openWin: Window | null = null;
let reload: (() => Promise<void>) | null = null;

export type RowAction = "author" | "journal" | "rule";
export type RowActionHandler = (
  action: RowAction,
  s: StoredItem,
  win: Window,
) => Promise<void>;

/** Open (or focus) the "All fetched articles" window. */
export function openAllItems(store: Store, onAction: RowActionHandler): void {
  if (openWin && isWindowAlive(openWin)) {
    openWin.focus();
    return;
  }
  const win = Zotero.getMainWindow().openDialog(
    `chrome://${addon.data.config.addonRef}/content/allItems.xhtml`,
    "researchradar-all-items",
    "chrome,resizable,centerscreen,width=1100,height=720",
  ) as Window;
  openWin = win;
  win.addEventListener("load", () => void init(win, store, onAction), {
    once: true,
  });
}

async function init(
  win: Window,
  store: Store,
  onAction: RowActionHandler,
): Promise<void> {
  const doc = win.document;
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const tiersBox = $<HTMLElement>("tiers");
  const journalsBox = $<HTMLElement>("journals");
  const search = $<HTMLInputElement>("search");
  const sortBox = $<HTMLElement>("sort");
  const count = $<HTMLParagraphElement>("count");
  const rows = $<HTMLElement>("rows");

  let stored: StoredItem[] = await store.allItems();
  reload = async () => {
    stored = await store.allItems();
    renderFilters();
    render();
  };

  // Right-click menu, drawn by the page itself: Zotero's separate windows
  // cannot show a page's native menus (the same reason there are no <select>s)
  let menu: HTMLElement | null = null;
  const closeMenu = () => {
    menu?.remove();
    menu = null;
  };
  function showMenu(x: number, y: number, s: StoredItem) {
    closeMenu();
    const item = (label: string, run: () => void, enabled = true) =>
      h(doc, "button", {
        text: label,
        attrs: { type: "button", disabled: !enabled },
        on: {
          click: () => {
            closeMenu();
            run();
          },
        },
      });
    const act = (a: RowAction) => () =>
      void onAction(a, s, win).catch((e) => Zotero.logError(e));
    menu = h(
      doc,
      "div",
      { class: "ctx", attrs: { role: "menu" } },
      item("Watch an author…", act("author"), s.item.authors.length > 0),
      item("Follow this journal", act("journal")),
      item("Make a rule from this article…", act("rule")),
      h(doc, "hr"),
      item(
        "Add article to library",
        () => {
          const btn = rows.querySelector(
            `button[data-key="${CSS.escape(s.item.key)}"]`,
          ) as HTMLButtonElement | null;
          btn?.click();
        },
        canAddToRadar(s),
      ),
    );
    (doc.body ?? doc.documentElement)!.append(menu);
    // Keep the menu inside the window
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, win.innerWidth - r.width - 8)}px`;
    menu.style.top = `${Math.min(y, win.innerHeight - r.height - 8)}px`;
  }
  doc.addEventListener("mousedown", (e) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  });
  win.addEventListener("blur", closeMenu);
  const filter: ViewFilter = { ...DEFAULT_FILTER };

  /** A toggle button; `pressed` marks the current choice. */
  const toggle = (
    label: Node[] | string,
    pressed: boolean,
    onClick: () => void,
  ) => {
    const b = h(doc, "button", {
      attrs: { type: "button", "aria-pressed": String(pressed) },
      on: { click: onClick },
    });
    if (typeof label === "string") b.textContent = label;
    else b.append(...label);
    return b;
  };

  /** Tier buttons, sort buttons and the journal list, with counts. */
  function renderFilters() {
    const counts = tierCounts(stored);
    clear(tiersBox);
    for (const t of Object.keys(TIER_LABEL) as TierFilter[])
      tiersBox.append(
        toggle(`${TIER_LABEL[t]} ${counts[t]}`, filter.tier === t, () => {
          filter.tier = t;
          renderFilters();
          render();
        }),
      );

    clear(sortBox);
    for (const [value, label] of [
      ["newest", "Newest"],
      ["points", "Most points"],
    ] as const)
      sortBox.append(
        toggle(label, filter.sort === value, () => {
          filter.sort = value;
          renderFilters();
          render();
        }),
      );

    clear(journalsBox);
    const entry = (id: string, title: string, n: number) =>
      toggle(
        [
          h(doc, "span", { text: title }),
          h(doc, "span", { class: "n", text: String(n) }),
        ],
        filter.journalId === id,
        () => {
          filter.journalId = id;
          renderFilters();
          render();
        },
      );
    journalsBox.append(entry("", "All journals", stored.length));
    for (const j of journalOptions(stored))
      journalsBox.append(entry(j.id, j.title, j.count));
  }

  function openArticle(s: StoredItem) {
    const url = s.item.doi ? `https://doi.org/${s.item.doi}` : s.item.url;
    if (url) Zotero.launchURL(url);
  }

  function actionCell(s: StoredItem): HTMLElement {
    const status = statusLabel(s);
    if (!canAddToRadar(s))
      return h(doc, "span", { class: "status", text: status });
    const btn = h(doc, "button", {
      text: "Add article to library",
      attrs: { "data-key": s.item.key },
      title:
        "Adds this article to your library in Radar/Possible, with its explanation note. Your journals, rules and authors are not changed.",
      on: {
        click: async () => {
          btn.disabled = true;
          btn.textContent = "Adding…";
          try {
            const result = await addToRadarByHand(store, s);
            stored = await store.allItems();
            renderFilters();
            const cell = btn.parentElement!;
            clear(cell);
            cell.append(
              h(doc, "span", {
                class: "status",
                text:
                  result === "added" ? "Added (kept)" : "Already in library",
              }),
            );
          } catch (e: any) {
            Zotero.logError(e);
            btn.disabled = false;
            btn.textContent = "Add article to library";
            btn.title = `Failed: ${e?.message ?? e}`;
          }
        },
      },
    });
    return h(
      doc,
      "span",
      {},
      btn,
      status ? h(doc, "div", { class: "status", text: status }) : null,
    );
  }

  function render() {
    const shown = filterItems(stored, filter);
    count.textContent =
      shown.length > MAX_ROWS
        ? `Showing the first ${MAX_ROWS} of ${shown.length} articles. Narrow them down with the filters.`
        : `${shown.length} article${shown.length === 1 ? "" : "s"}. Right-click an article to watch an author, follow its journal or make a rule from it.`;
    clear(rows);
    if (stored.length === 0) {
      rows.append(
        h(doc, "p", {
          class: "muted",
          text: "Nothing fetched yet: use Tools → Research Radar: Fetch now.",
        }),
      );
      return;
    }
    rows.append(
      h(
        doc,
        "table",
        {},
        h(
          doc,
          "tr",
          {},
          ...["Tier", "Points", "Article", "Journal", "Date", "Why", ""].map(
            (t) => h(doc, "th", { text: t }),
          ),
        ),
        ...shown.slice(0, MAX_ROWS).map((s) => {
          const tier = s.score?.excluded
            ? "excluded"
            : (s.score?.tier ?? "rest");
          const authors = s.item.authors.map((a) => a.family).join(", ");
          return h(
            doc,
            "tr",
            {
              title: "Right-click for more actions",
              on: {
                contextmenu: (e) => {
                  e.preventDefault();
                  const m = e as MouseEvent;
                  showMenu(m.clientX, m.clientY, s);
                },
              },
            },
            h(
              doc,
              "td",
              {},
              h(doc, "span", { class: `tier ${tier}`, text: TIER_LABEL[tier] }),
            ),
            h(doc, "td", { class: "num", text: String(s.score?.total ?? "–") }),
            h(
              doc,
              "td",
              {},
              h(doc, "a", {
                class: "title",
                text: s.item.title,
                title: "Open the article in your browser",
                on: { click: () => openArticle(s) },
              }),
              authors
                ? h(doc, "div", { class: "byline", text: authors })
                : null,
            ),
            h(doc, "td", { text: s.item.journalTitle }),
            h(doc, "td", { class: "num", text: s.item.date ?? "" }),
            h(doc, "td", {
              class: "why",
              text: s.score ? summarize(s.score) : "Not scored yet",
            }),
            h(doc, "td", {}, actionCell(s)),
          );
        }),
      ),
    );
  }

  search.addEventListener("input", () => {
    filter.text = search.value;
    render();
  });
  doc.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Escape") return;
    if (menu) closeMenu();
    else win.close();
  });

  renderFilters();
  render();
  search.focus();
}

/** Reload and redraw the window if it is open (after settings changed). */
export async function refreshAllItems(): Promise<void> {
  if (openWin && isWindowAlive(openWin) && reload) await reload();
}

export function closeAllItems(): void {
  if (openWin && isWindowAlive(openWin)) openWin.close();
  openWin = null;
  reload = null;
}
