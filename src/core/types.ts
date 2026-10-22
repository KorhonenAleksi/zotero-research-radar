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
