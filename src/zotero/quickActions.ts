import { journalId } from "../core/catalogue";
import { normalizeIssn, isValidIssn } from "../core/issn";
import {
  buildJournalSearchUrl,
  parseJournalSearch,
} from "../core/journalSearch";
import {
  authorName,
  isWatched,
  labelFromQuery,
  suggestRuleQuery,
} from "../core/quickRules";
import { compileScoring, DEFAULT_SCORING, scoreItem } from "../core/rules";
import { newId, normalizeOrcid, queryError } from "../core/settings";
import type { Store } from "../core/store";
import type { Author, Journal, RadarItem } from "../core/types";
import { getPref } from "../utils/prefs";
import { getJson } from "./http";
import { loadSettings, saveAuthors, saveJournals, saveRules } from "./settings";

/**
 * Right-click actions that build settings from an article: watch one of its
 * authors, follow its journal, or make a keyword rule from its title. They
 * only change settings (never library items), then re-score stored articles.
 */

const TITLE = "Research Radar";

export interface ActionHooks {
  /** Re-score stored articles and refresh any open view. */
  afterChange: () => Promise<void>;
  notify: (lines: string[], type?: "success" | "default" | "fail") => void;
}

/** What the actions need to know about an article. */
export interface ArticleInfo {
  title: string;
  authors: Author[];
  journalTitle: string;
  issns: string[];
  doi?: string;
}

export function infoFromRadarItem(item: RadarItem): ArticleInfo {
  return {
    title: item.title,
    authors: item.authors,
    journalTitle: item.journalTitle,
    issns: isValidIssn(item.journalId) ? [item.journalId] : [],
    doi: item.doi,
  };
}

/** From a Zotero item; a Radar item's stored record adds ORCIDs and ISSNs. */
export async function infoFromZoteroItem(
  zi: Zotero.Item,
  store: Store | null,
): Promise<ArticleInfo> {
  const link = store ? await store.linkForZoteroItem(zi.id) : undefined;
  const stored = link && store ? await store.getItem(link.key) : undefined;
  if (stored) return infoFromRadarItem(stored);
  const field = (f: string) => {
    try {
      return String(zi.getField(f as any) ?? "").trim();
    } catch {
      return ""; // field not valid for this item type
    }
  };
  const issns = (field("ISSN").match(/\d{4}-?\d{3}[\dXx]/g) ?? [])
    .map((s) => normalizeIssn(s))
    .filter((s): s is string => !!s && isValidIssn(s));
  const authors = zi
    .getCreators()
    .filter(
      (c: any) =>
        !c.creatorTypeID ||
        Zotero.CreatorTypes.getName(c.creatorTypeID) === "author",
    )
    .map((c: any) => ({ given: c.firstName || undefined, family: c.lastName }))
    .filter((a: Author) => !!a.family);
  return {
    title: field("title"),
    authors,
    journalTitle: field("publicationTitle"),
    issns,
    doi: field("DOI") || undefined,
  };
}

function window_(): Window {
  return Zotero.getMainWindow() as unknown as Window;
}

// ---- watch an author ----

export async function watchAuthor(
  info: ArticleInfo,
  hooks: ActionHooks,
  win: Window = window_(),
): Promise<void> {
  if (info.authors.length === 0) {
    hooks.notify(["This article has no authors listed"]);
    return;
  }
  const { scoring } = loadSettings();
  let author = info.authors[0];
  if (info.authors.length > 1) {
    const names = info.authors.map(
      (a) =>
        authorName(a) +
        (isWatched(a, scoring.authors) ? "  (already watched)" : ""),
    );
    const choice = { value: 0 };
    const ok = Services.prompt.select(
      win as any,
      TITLE,
      "Watch which author? Their new papers will rank High.",
      names,
      choice,
    );
    if (!ok) return;
    author = info.authors[choice.value];
  }
  if (isWatched(author, scoring.authors)) {
    hooks.notify([`Already watching ${authorName(author)}`]);
    return;
  }
  const watched = {
    id: newId("author", scoring.authors),
    family: author.family,
    given: author.given,
    orcid: normalizeOrcid(author.orcid) ?? undefined,
    weight: 5,
  };
  saveAuthors([...scoring.authors, watched]);
  await hooks.afterChange();
  hooks.notify(
    [
      `Watching ${authorName(author)}`,
      watched.orcid ? "Matched by ORCID iD" : "Matched by name + initial",
    ],
    "success",
  );
}

// ---- follow the journal ----

async function lookupJournal(info: ArticleInfo): Promise<Journal | null> {
  const mailto = String(getPref("mailto") ?? "").trim() || undefined;
  let issns = info.issns;
  if (issns.length === 0 && info.doi) {
    // The article's DOI record names its journal's ISSNs
    const url = `https://api.crossref.org/works/${encodeURIComponent(info.doi)}${mailto ? `?mailto=${encodeURIComponent(mailto)}` : ""}`;
    const work = (await getJson(url)) as any;
    issns = ((work?.message?.ISSN ?? []) as string[])
      .map((s) => normalizeIssn(s))
      .filter((s): s is string => !!s && isValidIssn(s));
  }
  if (issns.length) {
    const data = (await getJson(
      `https://api.crossref.org/journals/${issns[0]}${mailto ? `?mailto=${encodeURIComponent(mailto)}` : ""}`,
    )) as any;
    const [c] = parseJournalSearch(
      { message: { items: [data?.message] } },
      info.journalTitle,
    );
    if (c) return candidateToJournal(c);
  }
  if (info.journalTitle) {
    const data = await getJson(
      buildJournalSearchUrl(info.journalTitle, { mailto }),
    );
    const exact = parseJournalSearch(data, info.journalTitle).filter(
      (c) => c.exactTitle,
    );
    if (exact.length) return candidateToJournal(exact[0]);
  }
  return null;
}

function candidateToJournal(
  c: ReturnType<typeof parseJournalSearch>[number],
): Journal {
  return {
    id: journalId(c.issnPrint, c.issnElectronic)!,
    title: c.title,
    publisher: c.publisher || undefined,
    issnPrint: c.issnPrint,
    issnElectronic: c.issnElectronic,
    crossref: true,
    source: "search",
  };
}

export async function followJournal(
  info: ArticleInfo,
  hooks: ActionHooks,
): Promise<void> {
  const { journals } = loadSettings();
  const known = journals.find((j) =>
    info.issns.some((i) => i === j.issnPrint || i === j.issnElectronic),
  );
  if (known) {
    hooks.notify([`Already following ${known.title}`]);
    return;
  }
  let journal: Journal | null;
  try {
    journal = await lookupJournal(info);
  } catch (e: any) {
    hooks.notify(["Journal lookup failed", String(e?.message ?? e)], "fail");
    return;
  }
  if (!journal) {
    hooks.notify(
      ["Journal not found in Crossref", "Add it in Settings by search"],
      "fail",
    );
    return;
  }
  if (journals.some((j) => j.id === journal!.id)) {
    hooks.notify([`Already following ${journal.title}`]);
    return;
  }
  saveJournals([...journals, journal]);
  await hooks.afterChange();
  hooks.notify(
    [`Following ${journal.title}`, "New articles from the next fetch"],
    "success",
  );
}

// ---- make a rule from the title ----

export async function ruleFromArticle(
  info: ArticleInfo,
  hooks: ActionHooks,
  store: Store | null,
  win: Window = window_(),
): Promise<void> {
  let value = suggestRuleQuery(info.title);
  let problem = "";
  for (;;) {
    const input = { value };
    const ok = Services.prompt.prompt(
      win as any,
      TITLE,
      `${problem ? `${problem}\n\n` : ""}New keyword rule, suggested from:\n“${info.title}”\n\n` +
        'Edit as you like: "quoted phrases", OR / AND / NOT in capitals, and * for word families (histor*). Matches in titles count 3×.',
      input,
      null as any,
      { value: false },
    );
    if (!ok) return;
    value = input.value.trim();
    const err = value ? queryError(value) : "The rule is empty.";
    if (!err) break;
    problem = `That rule has a problem: ${err}`;
  }
  const { scoring } = loadSettings();
  if (scoring.rules.some((r) => r.query.trim() === value)) {
    hooks.notify(["You already have this rule"]);
    return;
  }
  const rule = {
    id: newId("rule", scoring.rules),
    label: labelFromQuery(value),
    query: value,
    weight: 1,
  };
  saveRules([...scoring.rules, rule]);
  await hooks.afterChange();
  // How many already-fetched articles the new rule matches, as feedback
  let matches = 0;
  if (store) {
    const only = compileScoring({ ...DEFAULT_SCORING, rules: [rule] });
    matches = (await store.allItems()).filter(
      (s) => scoreItem(s.item, only).total > 0,
    ).length;
  }
  hooks.notify(
    [
      `Rule added: ${rule.label}`,
      `Matches ${matches} fetched article${matches === 1 ? "" : "s"}`,
    ],
    "success",
  );
}
