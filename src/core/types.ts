/** Where a journal in the user's list came from. */
export type JournalSource = "catalogue" | "search" | "manual";

/** A journal the user can follow. */
export interface Journal {
  /** Stable key: the first available ISSN (print, else electronic). */
  id: string;
  title: string;
  publisher?: string;
  issnPrint?: string;
  issnElectronic?: string;
  /** RSS/Atom feed URL; optional because Crossref alone works for most journals. */
  feedUrl?: string;
  /** False when the journal does not register DOIs with Crossref (RSS only). */
  crossref: boolean;
  source: JournalSource;
  /** Named list the journal came from, e.g. "FT50 (2026)". */
  list?: string;
  note?: string;
}

export interface Author {
  given?: string;
  family: string;
  /** Bare ORCID iD, e.g. "0000-0002-3933-920X". */
  orcid?: string;
}

export type ItemSource = "crossref" | "rss";

/** One article as ingested, after merging Crossref and RSS. */
export interface RadarItem {
  /** Dedupe key: "doi:<normalised doi>", or "t:<hash>" when no DOI is known. */
  key: string;
  doi?: string;
  title: string;
  abstract?: string;
  authors: Author[];
  journalId: string;
  journalTitle: string;
  /** Best available publication date, ISO "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
  date?: string;
  url?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  sources: ItemSource[];
  /** No abstract from any source: scoring can only use the title. */
  titleOnly: boolean;
}

/** A journal found through the Crossref journal search, before the user adds it. */
export interface JournalCandidate {
  title: string;
  publisher: string;
  issnPrint?: string;
  issnElectronic?: string;
  /** Articles from the current and previous two years in Crossref: shows whether the journal is active. */
  currentDois: number;
  totalDois: number;
  /** Title matches the query exactly (ignoring case, "The", "&" vs "and", punctuation). */
  exactTitle: boolean;
}
