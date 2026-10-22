import { queryError } from "./settings";
import { fold } from "./text";
import type { Author } from "./types";
import type { WatchedAuthor } from "./rules";

/**
 * Words that say little about a paper's topic. Used only to suggest a rule
 * from a title; the user always sees and can edit the suggestion.
 */
const FILLER = new Set(
  (
    "a an the of in on for to and or but with without from by at as into onto over under " +
    "about between among through across within beyond toward towards against during after before " +
    "is are was were be been being do does did can could should would may might will shall " +
    "this that these those its their his her our your it they we you he she " +
    "how why what when where which who whom whose whether not no " +
    "study studies evidence approach analysis effect effects role case cases new " +
    "using based perspective perspectives review revisited revisiting implications insights " +
    "toward lessons examining exploring understanding introduction special issue editorial " +
    "early late us uk eu " +
    "information contents board correction corrigendum erratum retraction front matter cover index notes contributors"
  ).split(/\s+/),
);

function isContent(word: string): boolean {
  return word.length >= 3 && !FILLER.has(word) && !/^\d+$/.test(word);
}

/**
 * Suggest a rule query from an article title: the runs of consecutive
 * topic words, as quoted phrases ORed together (at most three), e.g.
 * "Civilising business: The imperial episteme of early US business schools"
 * → "civilising business" OR "imperial episteme" OR "business schools".
 */
export function suggestRuleQuery(title: string): string {
  const runs: string[][] = [];
  for (const segment of fold(title).split(/[:;?!.()]/)) {
    let run: string[] = [];
    for (const w of segment.split(/[^a-z0-9-]+/).filter(Boolean)) {
      const word = w.replace(/^-+|-+$/g, "");
      if (word && isContent(word)) run.push(word);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
  }
  const phrases = runs
    .map((r) => r.slice(0, 3))
    .filter((r) => r.length >= 2 || r[0].length >= 6)
    .sort((a, b) => b.length - a.length);
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const r of phrases) {
    const p = r.join(" ");
    if (seen.has(p)) continue;
    seen.add(p);
    picked.push(r.length > 1 ? `"${p}"` : p);
    if (picked.length === 3) break;
  }
  const query = picked.join(" OR ");
  return query && !queryError(query) ? query : "";
}

/** Short label for a new rule: its first phrase, capitalised. */
export function labelFromQuery(query: string): string {
  const first = query
    .split(/\s+OR\s+|\s+AND\s+/)[0]
    .replace(/["()*]/g, "")
    .trim();
  const label = first.charAt(0).toUpperCase() + first.slice(1);
  return label.length > 30 ? `${label.slice(0, 29)}…` : label;
}

/** Identity used to avoid watching the same person twice. */
export function authorKey(a: {
  family: string;
  given?: string;
  orcid?: string;
}): string {
  return a.orcid ?? `${fold(a.family)}|${fold(a.given ?? "")[0] ?? ""}`;
}

export function isWatched(author: Author, watched: WatchedAuthor[]): boolean {
  return watched.some(
    (w) =>
      (w.orcid && author.orcid && w.orcid === author.orcid) ||
      authorKey({ family: w.family, given: w.given }) ===
        authorKey({ family: author.family, given: author.given }),
  );
}

export function authorName(a: { family: string; given?: string }): string {
  return a.given ? `${a.given} ${a.family}` : a.family;
}
