import { normalizeDoi } from "./doi";
import { itemKey } from "./itemKey";
import { cleanAbstract, stripMarkup } from "./markup";
import type { Author, Journal, RadarItem } from "./types";

const CROSSREF_WORKS = "https://api.crossref.org/works";

const SELECT = [
  "DOI",
  "title",
  "abstract",
  "author",
  "created",
  "published",
  "container-title",
  "URL",
  "type",
  "volume",
  "issue",
  "page",
].join(",");

/**
 * Crossref query for articles in one journal registered since `since`
 * (YYYY-MM-DD). Both ISSNs are passed, which Crossref ORs together.
 * "created" is the DOI registration date: the best signal for "new".
 */
export function buildWorksUrl(
  journal: Pick<Journal, "issnPrint" | "issnElectronic">,
  since: string,
  opts: { rows?: number; mailto?: string } = {},
): string {
  const issns = [journal.issnPrint, journal.issnElectronic].filter(Boolean);
  if (issns.length === 0) throw new Error("Journal has no ISSN");
  const filter = [
    ...issns.map((i) => `issn:${i}`),
    `from-created-date:${since}`,
    "type:journal-article",
  ].join(",");
  const params = new URLSearchParams({
    filter,
    rows: String(opts.rows ?? 100),
    select: SELECT,
    sort: "created",
    order: "desc",
  });
  if (opts.mailto) params.set("mailto", opts.mailto);
  return `${CROSSREF_WORKS}?${params}`;
}

interface CrossrefDate {
  "date-parts"?: Array<Array<number | null>>;
}

interface CrossrefWork {
  DOI?: string;
  title?: string[];
  abstract?: string;
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
    ORCID?: string;
  }>;
  published?: CrossrefDate;
  created?: CrossrefDate;
  "container-title"?: string[];
  URL?: string;
  volume?: string;
  issue?: string;
  page?: string;
}

function isoDate(d: CrossrefDate | undefined): string | undefined {
  const parts = d?.["date-parts"]?.[0]?.filter((n): n is number => n != null);
  if (!parts?.length) return undefined;
  return parts
    .slice(0, 3)
    .map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, "0")))
    .join("-");
}

function mapAuthor(
  a: NonNullable<CrossrefWork["author"]>[number],
): Author | null {
  const family = (a.family ?? a.name ?? "").trim();
  if (!family) return null;
  const orcid = a.ORCID?.match(
    /\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i,
  )?.[0].toUpperCase();
  return { given: a.given?.trim() || undefined, family, orcid };
}

/** Map a Crossref /works response to items for `journal`. */
export function mapWorks(response: unknown, journal: Journal): RadarItem[] {
  const works =
    (response as { message?: { items?: CrossrefWork[] } })?.message?.items ??
    [];
  const items: RadarItem[] = [];
  for (const w of works) {
    const title = stripMarkup(w.title?.[0]);
    if (!title) continue;
    const doi = normalizeDoi(w.DOI) ?? undefined;
    const abstract = cleanAbstract(w.abstract);
    items.push({
      key: itemKey(doi, journal.id, title),
      doi,
      title,
      abstract,
      authors: (w.author ?? []).map(mapAuthor).filter((a): a is Author => !!a),
      journalId: journal.id,
      // Crossref sends some names HTML-escaped ("Learning &amp; Education")
      journalTitle: stripMarkup(w["container-title"]?.[0]) || journal.title,
      date: isoDate(w.published) ?? isoDate(w.created),
      url: w.URL,
      volume: w.volume,
      issue: w.issue,
      pages: w.page,
      sources: ["crossref"],
      titleOnly: !abstract,
    });
  }
  return items;
}
