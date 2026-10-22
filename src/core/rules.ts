import {
  evaluate,
  matchedTerms,
  parseQuery,
  QueryError,
  type QueryNode,
} from "./query";
import { fold, prepare, type PreparedText } from "./text";
import type { RadarItem } from "./types";

export type Tier = "high" | "possible" | "rest";

export interface KeywordRule {
  id: string;
  /** Short name shown in explanations, e.g. "Decline". Defaults to the query. */
  label?: string;
  query: string;
  /** Points when the rule matches in the abstract; title matches are multiplied by the title weight. */
  weight: number;
  /** An exclusion rule hides matching items (they stay viewable). */
  exclude?: boolean;
  enabled?: boolean;
}

export interface WatchedAuthor {
  id: string;
  family: string;
  given?: string;
  orcid?: string;
  weight: number;
}

export interface ScoringSettings {
  rules: KeywordRule[];
  authors: WatchedAuthor[];
  /** Extra points per journal id, added only when something else already matched. */
  journalBonus: Record<string, number>;
  fieldWeights: { title: number; abstract: number };
  thresholds: { high: number; possible: number };
}

export const DEFAULT_SCORING: ScoringSettings = {
  rules: [],
  authors: [],
  journalBonus: {},
  fieldWeights: { title: 3, abstract: 1 },
  // With weight-1 rules: one abstract match → Possible needs 2, so a single
  // abstract hit stays in Rest; one title hit (3 points) → Possible;
  // a title hit plus anything else, or a watched author (default 5) → High.
  thresholds: { high: 5, possible: 2 },
};

export type Reason =
  | {
      kind: "rule";
      label: string;
      field: "title" | "abstract";
      terms: string[];
      points: number;
    }
  | { kind: "author"; name: string; via: "orcid" | "name"; points: number }
  | { kind: "journal"; journal: string; points: number }
  | { kind: "exclude"; label: string; terms: string[] };

export interface ScoreResult {
  tier: Tier;
  total: number;
  excluded: boolean;
  titleOnly: boolean;
  components: { rules: number; authors: number; journal: number };
  reasons: Reason[];
}

interface CompiledRule {
  rule: KeywordRule;
  label: string;
  node: QueryNode;
}

export interface CompiledScoring {
  settings: ScoringSettings;
  rules: CompiledRule[];
  /** Rules that could not be parsed; shown in the settings pane, skipped when scoring. */
  errors: Array<{ ruleId: string; message: string }>;
}

export function compileScoring(settings: ScoringSettings): CompiledScoring {
  const rules: CompiledRule[] = [];
  const errors: CompiledScoring["errors"] = [];
  for (const rule of settings.rules) {
    if (rule.enabled === false) continue;
    try {
      rules.push({
        rule,
        label: rule.label?.trim() || rule.query.trim(),
        node: parseQuery(rule.query),
      });
    } catch (e) {
      if (!(e instanceof QueryError)) throw e;
      errors.push({ ruleId: rule.id, message: e.message });
    }
  }
  return { settings, rules, errors };
}

/** Title and abstract joined, with a gap token so phrases can't span the two. */
function joined(a: PreparedText, b: PreparedText): PreparedText {
  return {
    words: [...a.words, "\u0000", ...b.words],
    stems: [...a.stems, "\u0000", ...b.stems],
  };
}

function authorMatch(
  item: RadarItem,
  w: WatchedAuthor,
): "orcid" | "name" | null {
  const family = fold(w.family);
  const initial = w.given ? fold(w.given)[0] : undefined;
  for (const a of item.authors) {
    if (w.orcid && a.orcid) {
      if (w.orcid.toUpperCase() === a.orcid.toUpperCase()) return "orcid";
      continue; // both have ORCIDs and they differ: a namesake
    }
    if (fold(a.family) !== family) continue;
    if (initial && a.given && fold(a.given)[0] !== initial) continue;
    return "name";
  }
  return null;
}

function tierFor(total: number, t: ScoringSettings["thresholds"]): Tier {
  if (total >= t.high) return "high";
  if (total >= t.possible) return "possible";
  return "rest";
}

/** Score one item. Pure: same item + settings always give the same result. */
export function scoreItem(
  item: RadarItem,
  compiled: CompiledScoring,
): ScoreResult {
  const { settings } = compiled;
  const title = prepare(item.title);
  const abstract = prepare(item.abstract);
  const both = joined(title, abstract);
  const reasons: Reason[] = [];
  let rulePoints = 0;
  let excluded = false;

  for (const { rule, label, node } of compiled.rules) {
    if (!evaluate(node, both)) continue;
    if (rule.exclude) {
      excluded = true;
      reasons.push({ kind: "exclude", label, terms: matchedTerms(node, both) });
      continue;
    }
    const inTitle = matchedTerms(node, title);
    const field = inTitle.length ? "title" : "abstract";
    const points = rule.weight * settings.fieldWeights[field];
    rulePoints += points;
    reasons.push({
      kind: "rule",
      label,
      field,
      terms: inTitle.length ? inTitle : matchedTerms(node, abstract),
      points,
    });
  }

  let authorPoints = 0;
  for (const w of settings.authors) {
    const via = authorMatch(item, w);
    if (!via) continue;
    authorPoints += w.weight;
    const name = w.given ? `${w.given} ${w.family}` : w.family;
    reasons.push({ kind: "author", name, via, points: w.weight });
  }

  let journalPoints = 0;
  const bonus = settings.journalBonus[item.journalId] ?? 0;
  if (bonus && rulePoints + authorPoints > 0) {
    journalPoints = bonus;
    reasons.push({
      kind: "journal",
      journal: item.journalTitle,
      points: bonus,
    });
  }

  const total = rulePoints + authorPoints + journalPoints;
  return {
    tier: excluded ? "rest" : tierFor(total, settings.thresholds),
    total,
    excluded,
    titleOnly: item.titleOnly,
    components: {
      rules: rulePoints,
      authors: authorPoints,
      journal: journalPoints,
    },
    reasons,
  };
}
