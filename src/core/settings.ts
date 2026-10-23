import { isValidIssn, normalizeIssn } from "./issn";
import { stripMarkup } from "./markup";
import { parseQuery, QueryError } from "./query";
import type { KeywordRule, WatchedAuthor } from "./rules";
import type { Journal } from "./types";

/**
 * Settings are stored as Zotero prefs; the list-valued ones as JSON strings.
 * Everything read back goes through these validators, so a hand-edited or
 * corrupted pref degrades to "entry skipped, warning shown", never a crash.
 */

export interface GeneralSettings {
  /** Fetch on startup and every N hours. Off by default: nothing runs until the user asks. */
  autoFetch: boolean;
  fetchIntervalHours: number;
  /** Unkept Radar items go to the Trash after this many days. 0 = never. */
  cleanupDays: number;
  /** At most this many new items are written to the library per fetch run. */
  maxNewPerRun: number;
  /** How far back to look the first time a journal is fetched. */
  firstFetchDays: number;
  /** Optional contact email sent to Crossref (polite pool). Empty = not sent. */
  mailto: string;
}

export const DEFAULT_GENERAL: GeneralSettings = {
  autoFetch: false,
  fetchIntervalHours: 12,
  cleanupDays: 30,
  maxNewPerRun: 15,
  firstFetchDays: 30,
  mailto: "",
};

export const LIMITS = {
  fetchIntervalHours: [1, 168],
  cleanupDays: [0, 365],
  maxNewPerRun: [1, 200],
  firstFetchDays: [1, 365],
  weight: [0, 100],
} as const;

export function clamp(
  n: unknown,
  [min, max]: readonly [number, number],
  fallback: number,
): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** ORCID iD check (ISO 7064 MOD 11-2). Accepts bare iDs or orcid.org URLs. */
export function normalizeOrcid(
  input: string | null | undefined,
): string | null {
  const m = input
    ?.toUpperCase()
    .match(/(\d{4})-?(\d{4})-?(\d{4})-?(\d{3}[\dX])/);
  if (!m) return null;
  const id = `${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
  const digits = id.replace(/-/g, "");
  let total = 0;
  for (let i = 0; i < 15; i++) total = (total + Number(digits[i])) * 2;
  const r = (12 - (total % 11)) % 11;
  const check = r === 10 ? "X" : String(r);
  return digits[15] === check ? id : null;
}

export interface Parsed<T> {
  value: T[];
  warnings: string[];
}

function parseList<T>(
  raw: string | undefined,
  validate: (x: unknown, i: number) => T | string,
): Parsed<T> {
  if (!raw || !raw.trim()) return { value: [], warnings: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      value: [],
      warnings: ["Saved list could not be read and was ignored."],
    };
  }
  if (!Array.isArray(data))
    return {
      value: [],
      warnings: ["Saved list is not a list and was ignored."],
    };
  const value: T[] = [];
  const warnings: string[] = [];
  data.forEach((x, i) => {
    const r = validate(x, i);
    if (typeof r === "string") warnings.push(r);
    else value.push(r);
  });
  return { value, warnings };
}

const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");

export function validateJournal(x: unknown, i = 0): Journal | string {
  const o = (x ?? {}) as Record<string, unknown>;
  // Also repairs titles saved HTML-escaped by version 0.6.0 and earlier
  const title = stripMarkup(str(o.title));
  const issnPrint = normalizeIssn(str(o.issnPrint));
  const issnElectronic = normalizeIssn(str(o.issnElectronic));
  const validIssns = [issnPrint, issnElectronic].filter(
    (s) => s && isValidIssn(s),
  );
  const feedUrl = str(o.feedUrl);
  if (!title) return `Journal ${i + 1} has no title and was skipped.`;
  if (validIssns.length === 0 && !feedUrl)
    return `"${title}" has neither a valid ISSN nor a feed URL and was skipped.`;
  if (feedUrl && !/^https?:\/\//i.test(feedUrl))
    return `"${title}": the feed URL must start with http:// or https://.`;
  const source =
    o.source === "catalogue" || o.source === "search" ? o.source : "manual";
  return {
    id: validIssns[0] ?? `feed:${feedUrl}`,
    title,
    publisher: stripMarkup(str(o.publisher)) || undefined,
    issnPrint: issnPrint && isValidIssn(issnPrint) ? issnPrint : undefined,
    issnElectronic:
      issnElectronic && isValidIssn(issnElectronic)
        ? issnElectronic
        : undefined,
    feedUrl: feedUrl || undefined,
    crossref: o.crossref !== false && validIssns.length > 0,
    source,
    list: str(o.list) || undefined,
    note: str(o.note) || undefined,
  };
}

export function validateRule(x: unknown, i = 0): KeywordRule | string {
  const o = (x ?? {}) as Record<string, unknown>;
  const query = str(o.query);
  if (!query) return `Rule ${i + 1} is empty and was skipped.`;
  return {
    id: str(o.id) || `rule-${i + 1}`,
    label: str(o.label) || undefined,
    query,
    weight: clamp(o.weight, LIMITS.weight, 1),
    exclude: o.exclude === true || undefined,
    enabled: o.enabled === false ? false : undefined,
  };
}

/** Error message for a rule query, or null when it parses. Used for live feedback while typing. */
export function queryError(query: string): string | null {
  try {
    parseQuery(query);
    return null;
  } catch (e) {
    if (e instanceof QueryError) return e.message;
    throw e;
  }
}

export function validateAuthor(x: unknown, i = 0): WatchedAuthor | string {
  const o = (x ?? {}) as Record<string, unknown>;
  const family = str(o.family);
  const rawOrcid = str(o.orcid);
  const orcid = normalizeOrcid(rawOrcid);
  if (!family) return `Author ${i + 1} has no family name and was skipped.`;
  if (rawOrcid && !orcid)
    return `${family}: "${rawOrcid}" is not a valid ORCID iD.`;
  return {
    id: str(o.id) || `author-${i + 1}`,
    family,
    given: str(o.given) || undefined,
    orcid: orcid ?? undefined,
    weight: clamp(o.weight, LIMITS.weight, 5),
  };
}

export const parseJournals = (raw?: string) => parseList(raw, validateJournal);
export const parseRules = (raw?: string) => parseList(raw, validateRule);
export const parseAuthors = (raw?: string) => parseList(raw, validateAuthor);

export function parseJournalBonus(raw?: string): Record<string, number> {
  try {
    const o = JSON.parse(raw || "{}");
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    return Object.fromEntries(
      Object.entries(o)
        .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
        .map(([k, v]) => [k, clamp(v, LIMITS.weight, 0)]),
    );
  } catch {
    return {};
  }
}

/** Short unique id for new rules/authors. */
export function newId(prefix: string, existing: Array<{ id: string }>): string {
  const used = new Set(existing.map((e) => e.id));
  for (let n = existing.length + 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!used.has(id)) return id;
  }
}
