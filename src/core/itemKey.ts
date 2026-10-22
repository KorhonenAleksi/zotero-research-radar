import { normalizeDoi } from "./doi";
import { normalizeTitle } from "./journalSearch";

/** 32-bit FNV-1a hash as 8 hex chars; enough to key items that lack a DOI. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Same journal + same normalised title = same article, for DOI-less feed items. */
export function titleKey(journalId: string, title: string): string {
  return `t:${fnv1a(`${journalId}|${normalizeTitle(title)}`)}`;
}

export function itemKey(
  doi: string | null | undefined,
  journalId: string,
  title: string,
): string {
  const d = normalizeDoi(doi);
  return d ? `doi:${d}` : titleKey(journalId, title);
}
