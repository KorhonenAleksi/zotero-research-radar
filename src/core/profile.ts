import type { KeywordRule, WatchedAuthor } from "./rules";
import {
  newId,
  queryError,
  validateAuthor,
  validateJournal,
  validateRule,
} from "./settings";
import { fold } from "./text";
import type { Journal } from "./types";

/** Format written by the AI setup prompt (src/core/aiSetupPrompt.ts). */
export const PROFILE_FORMAT = "research-radar-profile";
export const PROFILE_VERSION = 1;

export interface ProfilePreview {
  journals: Journal[];
  rules: KeywordRule[];
  authors: WatchedAuthor[];
  interests?: string;
  /** Entries already present in the user's settings, not added again. */
  duplicates: { journals: number; rules: number; authors: number };
  warnings: string[];
}

const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/**
 * Read a profile file and work out what importing it would add. Nothing is
 * applied here: the settings pane shows this preview and applies it only
 * when the user confirms. Import only adds; it never replaces or removes.
 */
export function previewProfile(
  text: string,
  current: {
    journals: Journal[];
    rules: KeywordRule[];
    authors: WatchedAuthor[];
  },
): ProfilePreview {
  let data: any;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!data || typeof data !== "object" || data.format !== PROFILE_FORMAT)
    throw new Error(
      `Not a Research Radar profile (expected "format": "${PROFILE_FORMAT}").`,
    );
  if (Number(data.version) > PROFILE_VERSION)
    throw new Error(
      "This profile was made for a newer version of Research Radar.",
    );

  const warnings: string[] = [];
  const duplicates = { journals: 0, rules: 0, authors: 0 };

  const journalIds = new Set(current.journals.map((j) => j.id));
  const journals: Journal[] = [];
  list(data.journals).forEach((x, i) => {
    const j = validateJournal(x, i);
    if (typeof j === "string") return warnings.push(j);
    if (journalIds.has(j.id)) return duplicates.journals++;
    journalIds.add(j.id);
    journals.push({ ...j, source: "manual", list: "AI profile" });
  });

  const queries = new Set(current.rules.map((r) => r.query.trim()));
  const rules: KeywordRule[] = [];
  list(data.rules).forEach((x, i) => {
    const r = validateRule(x, i);
    if (typeof r === "string") return warnings.push(r);
    const err = queryError(r.query);
    if (err)
      return warnings.push(`Rule "${r.label ?? r.query}" was skipped: ${err}`);
    if (queries.has(r.query)) return duplicates.rules++;
    queries.add(r.query);
    rules.push({ ...r, id: newId("rule", [...current.rules, ...rules]) });
  });

  const authorKey = (a: { family: string; given?: string; orcid?: string }) =>
    a.orcid ?? `${fold(a.family)}|${fold(a.given ?? "")[0] ?? ""}`;
  const authorKeys = new Set(current.authors.map(authorKey));
  const authors: WatchedAuthor[] = [];
  list(data.authors).forEach((x, i) => {
    const a = validateAuthor(x, i);
    if (typeof a === "string") return warnings.push(a);
    if (authorKeys.has(authorKey(a))) return duplicates.authors++;
    authorKeys.add(authorKey(a));
    authors.push({
      ...a,
      id: newId("author", [...current.authors, ...authors]),
    });
  });

  const interests =
    typeof data.interests === "string" ? data.interests.trim() : "";
  return {
    journals,
    rules,
    authors,
    interests: interests || undefined,
    duplicates,
    warnings,
  };
}
