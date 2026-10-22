import { stemmer } from "stemmer";

/** Lower-case and strip diacritics: "Obłój" → "obloj", "Économie" → "economie". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

/**
 * British -ise/-isation spellings to -ize, applied to queries and texts alike,
 * so "organisation" and "organization" stem the same. A rare false merge
 * ("prise"/"prize") is harmless because both sides are converted.
 */
function americanize(word: string): string {
  return word
    .replace(/isation(s?)$/, "ization$1")
    .replace(/isational$/, "izational")
    .replace(/is(e|es|ed|ing|er|ers)$/, "iz$1")
    .replace(/yse(s|d)?$/, "yze$1");
}

/** Words as normalised (folded, americanized) but not stemmed: used for prefix wildcards. */
export function words(s: string | undefined): string[] {
  if (!s) return [];
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(americanize);
}

export function stem(word: string): string {
  return stemmer(word);
}

/** A field prepared for matching: normalised words and their stems, position by position. */
export interface PreparedText {
  words: string[];
  stems: string[];
}

export function prepare(s: string | undefined): PreparedText {
  const w = words(s);
  return { words: w, stems: w.map(stem) };
}
