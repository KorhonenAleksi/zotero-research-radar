import { ft50Info, ft50Journals, journalId } from "../core/catalogue";
import {
  buildJournalSearchUrl,
  parseJournalSearch,
} from "../core/journalSearch";
import type { KeywordRule, WatchedAuthor } from "../core/rules";
import {
  clamp,
  LIMITS,
  newId,
  normalizeOrcid,
  queryError,
} from "../core/settings";
import type { Journal, JournalCandidate } from "../core/types";
import { getPref, setPref } from "../utils/prefs";
import { clear, h } from "./dom";
import { getJson } from "./http";
import { loadSettings, saveAuthors, saveJournals, saveRules } from "./settings";

type PrefKey = keyof _ZoteroTypes.Prefs["PluginPrefsMap"];

/** Settings pane controller. One instance per opened settings window. */
export function initPrefsPane(win: Window): void {
  const doc = win.document;
  const root = doc.getElementById("researchradar-pane");
  if (!root) return;

  const loaded = loadSettings();
  let journals = loaded.journals;
  let rules = loaded.scoring.rules;
  let authors = loaded.scoring.authors;
  const ft50 = ft50Journals();
  let searchResults: JournalCandidate[] = [];
  let searchStatus = "";
  let ft50Filter = "";

  const el = (id: string) => doc.getElementById(`researchradar-${id}`)!;

  // ---- warnings from invalid saved settings ----
  const warn = el("warnings");
  clear(warn);
  for (const w of loaded.warnings)
    warn.append(h(doc, "p", { class: "rr-warning", text: w }));

  // ---- journals ----
  const has = (id: string) => journals.some((j) => j.id === id);

  function setJournals(next: Journal[]) {
    journals = next;
    saveJournals(journals);
    renderJournals();
  }

  function addJournal(j: Journal) {
    if (!has(j.id)) setJournals([...journals, j]);
  }

  function removeJournal(id: string) {
    setJournals(journals.filter((j) => j.id !== id));
  }

  function renderMyJournals() {
    const box = el("my-journals");
    clear(box);
    box.append(
      h(doc, "h3", { text: `My journals (${journals.length})` }),
      journals.length === 0
        ? h(doc, "p", {
            class: "rr-muted",
            text: "No journals yet. Tick FT50 journals below or search for any journal.",
          })
        : h(
            doc,
            "ul",
            { class: "rr-list" },
            ...journals.map((j) => {
              const issns = [j.issnPrint, j.issnElectronic]
                .filter(Boolean)
                .join(", ");
              const feed = h(doc, "input", {
                class: "rr-feed",
                attrs: {
                  type: "url",
                  placeholder: "RSS feed URL (optional)",
                  value: j.feedUrl ?? "",
                },
                on: {
                  change: (e) => {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (v && !/^https?:\/\//i.test(v)) {
                      (e.target as HTMLInputElement).setCustomValidity(
                        "Must start with http:// or https://",
                      );
                      (e.target as HTMLInputElement).reportValidity();
                      return;
                    }
                    (e.target as HTMLInputElement).setCustomValidity("");
                    journals = journals.map((x) =>
                      x.id === j.id ? { ...x, feedUrl: v || undefined } : x,
                    );
                    saveJournals(journals);
                  },
                },
              });
              return h(
                doc,
                "li",
                {},
                h(
                  doc,
                  "div",
                  { class: "rr-row" },
                  h(doc, "strong", { text: j.title }),
                  h(doc, "span", {
                    class: "rr-muted",
                    text: ` ${[j.publisher, issns, j.list].filter(Boolean).join(" · ")}`,
                  }),
                  h(doc, "button", {
                    text: "Remove",
                    class: "rr-right",
                    on: { click: () => removeJournal(j.id) },
                  }),
                ),
                !j.crossref && !j.feedUrl
                  ? h(doc, "p", {
                      class: "rr-warning",
                      text: "Not in Crossref: add an RSS feed URL or nothing will be fetched.",
                    })
                  : j.note
                    ? h(doc, "p", { class: "rr-muted", text: j.note })
                    : null,
                feed,
              );
            }),
          ),
    );
  }

  // The heading and filter box are built once; only the checklist is
  // re-rendered, so typing in the filter keeps its cursor position.
  const ft50Box = el("ft50");
  clear(ft50Box);
  const ft50List = h(doc, "div", { class: "rr-checklist" });
  ft50Box.append(
    h(doc, "h3", { text: `${ft50Info.list} (${ft50Info.edition} edition)` }),
    h(doc, "input", {
      class: "rr-filter",
      attrs: { type: "search", placeholder: "Filter FT50…" },
      on: {
        input: (e) => {
          ft50Filter = (e.target as HTMLInputElement).value;
          renderFt50();
        },
      },
    }),
    ft50List,
  );

  function renderFt50() {
    clear(ft50List);
    const q = ft50Filter.trim().toLowerCase();
    const shown = ft50.filter((j) => j.title.toLowerCase().includes(q));
    if (shown.length === 0)
      ft50List.append(
        h(doc, "p", { class: "rr-muted", text: "No FT50 journal matches." }),
      );
    for (const j of shown) {
      const cb = h(doc, "input", {
        attrs: { type: "checkbox" },
        on: {
          change: (e) =>
            (e.target as HTMLInputElement).checked
              ? addJournal(j)
              : removeJournal(j.id),
        },
      });
      cb.checked = has(j.id);
      ft50List.append(
        h(
          doc,
          "label",
          { class: "rr-check" },
          cb,
          ` ${j.title}`,
          h(doc, "span", { class: "rr-muted", text: ` · ${j.publisher}` }),
        ),
      );
    }
  }

  async function runSearch(query: string) {
    if (query.trim().length < 3) {
      searchStatus = "Type at least 3 characters.";
      return renderSearch();
    }
    searchStatus = "Searching Crossref…";
    searchResults = [];
    renderSearch();
    try {
      const mailto = String(getPref("mailto") ?? "").trim() || undefined;
      const data = await getJson(buildJournalSearchUrl(query, { mailto }));
      searchResults = parseJournalSearch(data, query);
      searchStatus = searchResults.length ? "" : "No journals found.";
    } catch (e: any) {
      searchStatus = `Search failed: ${e.message}`;
    }
    renderSearch();
  }

  function renderSearch() {
    const results = el("search-results");
    clear(results);
    if (searchStatus)
      results.append(h(doc, "p", { class: "rr-muted", text: searchStatus }));
    results.append(
      h(
        doc,
        "ul",
        { class: "rr-list" },
        ...searchResults.map((c) => {
          const id = journalId(c.issnPrint, c.issnElectronic)!;
          const added = has(id);
          return h(
            doc,
            "li",
            { class: "rr-row" },
            h(doc, "strong", { text: c.title }),
            h(doc, "span", {
              class: "rr-muted",
              text: ` ${c.publisher} · ${[c.issnPrint, c.issnElectronic].filter(Boolean).join(", ")} · ${c.currentDois} recent articles`,
            }),
            h(doc, "button", {
              class: "rr-right",
              text: added ? "Added" : "Add",
              attrs: { disabled: added },
              on: {
                click: () =>
                  addJournal({
                    id,
                    title: c.title,
                    publisher: c.publisher,
                    issnPrint: c.issnPrint,
                    issnElectronic: c.issnElectronic,
                    crossref: true,
                    source: "search",
                  }),
              },
            }),
          );
        }),
      ),
    );
  }

  function renderJournals() {
    renderMyJournals();
    renderFt50();
    renderSearch();
  }

  const searchInput = el("search-input") as HTMLInputElement;
  el("search-button").addEventListener("click", () =>
    runSearch(searchInput.value),
  );
  searchInput.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      runSearch(searchInput.value);
    }
  });

  // ---- keyword rules ----
  function setRules(next: KeywordRule[], rerender = true) {
    rules = next;
    saveRules(rules);
    if (rerender) renderRules();
  }

  function updateRule(id: string, patch: Partial<KeywordRule>) {
    setRules(
      rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      false,
    );
  }

  function renderRules() {
    const box = el("rules");
    clear(box);
    box.append(
      h(
        doc,
        "table",
        { class: "rr-table" },
        h(
          doc,
          "tr",
          {},
          ...["Label", "Query", "Weight", "Exclude", ""].map((t) =>
            h(doc, "th", { text: t }),
          ),
        ),
        ...rules.map((r) => {
          const error = h(doc, "div", {
            class: "rr-error",
            text: queryError(r.query) ?? "",
          });
          return h(
            doc,
            "tr",
            {},
            h(
              doc,
              "td",
              {},
              h(doc, "input", {
                class: "rr-label",
                attrs: {
                  type: "text",
                  value: r.label ?? "",
                  placeholder: "e.g. Decline",
                },
                on: {
                  change: (e) =>
                    updateRule(r.id, {
                      label:
                        (e.target as HTMLInputElement).value.trim() ||
                        undefined,
                    }),
                },
              }),
            ),
            h(
              doc,
              "td",
              { class: "rr-wide" },
              h(doc, "input", {
                class: "rr-query",
                attrs: {
                  type: "text",
                  value: r.query,
                  placeholder: '"organizational decline" OR histor*',
                },
                on: {
                  input: (e) =>
                    (error.textContent =
                      queryError((e.target as HTMLInputElement).value) ?? ""),
                  change: (e) => {
                    const q = (e.target as HTMLInputElement).value.trim();
                    if (q) updateRule(r.id, { query: q });
                  },
                },
              }),
              error,
            ),
            h(
              doc,
              "td",
              {},
              h(doc, "input", {
                class: "rr-num",
                attrs: {
                  type: "number",
                  min: 0,
                  max: 100,
                  step: 1,
                  value: r.weight,
                },
                on: {
                  change: (e) =>
                    updateRule(r.id, {
                      weight: clamp(
                        (e.target as HTMLInputElement).value,
                        LIMITS.weight,
                        1,
                      ),
                    }),
                },
              }),
            ),
            h(
              doc,
              "td",
              {},
              (() => {
                const cb = h(doc, "input", {
                  attrs: {
                    type: "checkbox",
                    title: "Hide matching items (they stay viewable)",
                  },
                  on: {
                    change: (e) =>
                      updateRule(r.id, {
                        exclude:
                          (e.target as HTMLInputElement).checked || undefined,
                      }),
                  },
                });
                cb.checked = !!r.exclude;
                return cb;
              })(),
            ),
            h(
              doc,
              "td",
              {},
              h(doc, "button", {
                text: "Remove",
                on: {
                  click: () => setRules(rules.filter((x) => x.id !== r.id)),
                },
              }),
            ),
          );
        }),
      ),
      h(doc, "button", {
        text: "Add rule",
        on: {
          click: () => {
            setRules([
              ...rules,
              { id: newId("rule", rules), query: "", weight: 1 },
            ]);
            const inputs = el("rules").querySelectorAll(".rr-query");
            (inputs[inputs.length - 1] as HTMLInputElement)?.focus();
          },
        },
      }),
    );
  }

  // ---- watched authors ----
  function setAuthors(next: WatchedAuthor[], rerender = true) {
    authors = next;
    saveAuthors(authors);
    if (rerender) renderAuthors();
  }

  function updateAuthor(id: string, patch: Partial<WatchedAuthor>) {
    setAuthors(
      authors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      false,
    );
  }

  function renderAuthors() {
    const box = el("authors");
    clear(box);
    const text = (a: WatchedAuthor, key: "family" | "given", ph: string) =>
      h(doc, "input", {
        attrs: { type: "text", value: a[key] ?? "", placeholder: ph },
        on: {
          change: (e) =>
            updateAuthor(a.id, {
              [key]: (e.target as HTMLInputElement).value.trim() || undefined,
            }),
        },
      });
    box.append(
      h(
        doc,
        "table",
        { class: "rr-table" },
        h(
          doc,
          "tr",
          {},
          ...["Family name", "Given name", "ORCID iD", "Weight", ""].map((t) =>
            h(doc, "th", { text: t }),
          ),
        ),
        ...authors.map((a) => {
          const error = h(doc, "div", { class: "rr-error" });
          return h(
            doc,
            "tr",
            {},
            h(doc, "td", {}, text(a, "family", "Chandler")),
            h(doc, "td", {}, text(a, "given", "Alfred")),
            h(
              doc,
              "td",
              {},
              h(doc, "input", {
                attrs: {
                  type: "text",
                  value: a.orcid ?? "",
                  placeholder: "0000-0000-0000-0000 (optional)",
                },
                on: {
                  change: (e) => {
                    const raw = (e.target as HTMLInputElement).value.trim();
                    const orcid = normalizeOrcid(raw);
                    error.textContent =
                      raw && !orcid
                        ? "Not a valid ORCID iD (check the digits)."
                        : "";
                    if (!raw || orcid) {
                      (e.target as HTMLInputElement).value = orcid ?? "";
                      updateAuthor(a.id, { orcid: orcid ?? undefined });
                    }
                  },
                },
              }),
              error,
            ),
            h(
              doc,
              "td",
              {},
              h(doc, "input", {
                class: "rr-num",
                attrs: {
                  type: "number",
                  min: 0,
                  max: 100,
                  step: 1,
                  value: a.weight,
                },
                on: {
                  change: (e) =>
                    updateAuthor(a.id, {
                      weight: clamp(
                        (e.target as HTMLInputElement).value,
                        LIMITS.weight,
                        5,
                      ),
                    }),
                },
              }),
            ),
            h(
              doc,
              "td",
              {},
              h(doc, "button", {
                text: "Remove",
                on: {
                  click: () => setAuthors(authors.filter((x) => x.id !== a.id)),
                },
              }),
            ),
          );
        }),
      ),
      h(doc, "button", {
        text: "Add author",
        on: {
          click: () =>
            setAuthors([
              ...authors,
              { id: newId("author", authors), family: "", weight: 5 },
            ]),
        },
      }),
    );
  }

  // ---- general options: typed binding, so number prefs stay numbers ----
  const bindNumber = (
    key: PrefKey,
    limits: readonly [number, number],
    fallback: number,
  ) => {
    const input = el(`opt-${key}`) as HTMLInputElement;
    input.value = String(getPref(key));
    input.addEventListener("change", () => {
      const v = clamp(input.value, limits, fallback);
      input.value = String(v);
      setPref(key, v as never);
    });
  };
  const bindBool = (key: PrefKey) => {
    const input = el(`opt-${key}`) as HTMLInputElement;
    input.checked = getPref(key) === true;
    input.addEventListener("change", () =>
      setPref(key, input.checked as never),
    );
  };
  const bindText = (key: PrefKey) => {
    const input = el(`opt-${key}`) as HTMLInputElement;
    input.value = String(getPref(key) ?? "");
    input.addEventListener("change", () =>
      setPref(key, input.value.trim() as never),
    );
  };
  bindBool("autoFetch");
  bindNumber("fetchIntervalHours", LIMITS.fetchIntervalHours, 12);
  bindNumber("cleanupDays", LIMITS.cleanupDays, 30);
  bindNumber("maxNewPerRun", LIMITS.maxNewPerRun, 30);
  bindNumber("firstFetchDays", LIMITS.firstFetchDays, 30);
  bindText("mailto");
  bindNumber("titleWeight", LIMITS.weight, 3);
  bindNumber("abstractWeight", LIMITS.weight, 1);
  bindNumber("thresholdHigh", LIMITS.weight, 5);
  bindNumber("thresholdPossible", LIMITS.weight, 2);

  renderJournals();
  renderRules();
  renderAuthors();
}
