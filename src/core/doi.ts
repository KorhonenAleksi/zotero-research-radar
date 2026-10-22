/**
 * Normalise a DOI to its bare, lower-case form ("10.1002/smj.70136"), so the
 * same article coming from RSS and Crossref dedupes to one key.
 * Accepts "doi:" prefixes and doi.org / dx.doi.org URLs. Returns null when the
 * input does not contain a DOI.
 */
export function normalizeDoi(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep the raw string if it has stray % characters
  }
  const match = s.match(/10\.\d{4,9}\/\S+/);
  if (!match) return null;
  // Trailing punctuation often sticks to DOIs pulled out of feed text
  return match[0].replace(/[.,;)\]]+$/, "").toLowerCase();
}
