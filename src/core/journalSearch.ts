import { isValidIssn, normalizeIssn } from "./issn";
import type { JournalCandidate } from "./types";

const CROSSREF_JOURNALS = "https://api.crossref.org/journals";

/** URL for searching Crossref's journal titles. mailto is optional (Crossref "polite pool"). */
export function buildJournalSearchUrl(
  query: string,
  opts: { rows?: number; mailto?: string } = {},
): string {
  const params = new URLSearchParams({
    query: query.trim(),
    rows: String(opts.rows ?? 20),
  });
  if (opts.mailto) params.set("mailto", opts.mailto);
  return `${CROSSREF_JOURNALS}?${params}`;
}

/** Title comparison that ignores case, a leading "The", "&" vs "and", and punctuation. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
}

interface CrossrefJournal {
  title?: string;
  publisher?: string;
  "issn-type"?: Array<{ type: string | null; value: string }> | null;
  ISSN?: string[] | null;
  counts?: { "current-dois"?: number; "total-dois"?: number } | null;
}

/**
 * Turn a Crossref /journals response into candidates, best first:
 * exact title matches before partial ones, then by recent article count, so the
 * real "Journal of Management" (SAGE) beats small namesakes. Entries without
 * any ISSN are dropped because they cannot be fetched.
 */
export function parseJournalSearch(
  response: unknown,
  query: string,
): JournalCandidate[] {
  const items =
    (response as { message?: { items?: CrossrefJournal[] } })?.message?.items ??
    [];
  const q = normalizeTitle(query);
  const candidates: JournalCandidate[] = [];
  for (const item of items) {
    // Crossref occasionally mislabels or mistypes ISSNs (seen: ETP's "electronic"
    // 1540-8520 fails its check digit; the real one is listed untyped), so only
    // checksum-valid ISSNs are used, and untyped ones fill the gaps.
    const typed = (item["issn-type"] ?? []).filter((t) => isValidIssn(t.value));
    const pick = (type: string) =>
      normalizeIssn(typed.find((t) => t.type === type)?.value);
    const issnPrint = pick("print");
    let issnElectronic = pick("electronic");
    const spares = [
      ...typed.filter((t) => t.type !== "print" && t.type !== "electronic"),
      ...(item.ISSN ?? []).map((value) => ({ value })),
    ]
      .map((t) => normalizeIssn(t.value))
      .filter((s): s is string => !!s && isValidIssn(s) && s !== issnPrint);
    if (!issnElectronic || issnElectronic === issnPrint)
      issnElectronic = spares[0] ?? null;
    if (!issnPrint && !issnElectronic) continue;
    const title = (item.title ?? "").trim();
    candidates.push({
      title,
      publisher: (item.publisher ?? "").trim(),
      issnPrint: issnPrint ?? undefined,
      issnElectronic: issnElectronic ?? undefined,
      currentDois: item.counts?.["current-dois"] ?? 0,
      totalDois: item.counts?.["total-dois"] ?? 0,
      exactTitle: normalizeTitle(title) === q,
    });
  }
  return candidates.sort(
    (a, b) =>
      Number(b.exactTitle) - Number(a.exactTitle) ||
      b.currentDois - a.currentDois ||
      b.totalDois - a.totalDois,
  );
}
