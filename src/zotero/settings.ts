import type { AiSettings } from "../core/ai";
import { DEFAULT_SCORING, type ScoringSettings } from "../core/rules";
import {
  clamp,
  DEFAULT_GENERAL,
  LIMITS,
  parseAuthors,
  parseJournalBonus,
  parseJournals,
  parseRules,
  type GeneralSettings,
} from "../core/settings";
import type { Journal } from "../core/types";
import { getPref, setPref } from "../utils/prefs";

export interface LoadedSettings {
  general: GeneralSettings;
  journals: Journal[];
  scoring: ScoringSettings;
  warnings: string[];
}

/** Read all settings from prefs, validated. Never throws. */
export function loadSettings(): LoadedSettings {
  const journals = parseJournals(getPref("journals"));
  const rules = parseRules(getPref("rules"));
  const authors = parseAuthors(getPref("authors"));
  const d = DEFAULT_SCORING;
  return {
    general: {
      autoFetch: getPref("autoFetch") === true,
      fetchIntervalHours: clamp(
        getPref("fetchIntervalHours"),
        LIMITS.fetchIntervalHours,
        DEFAULT_GENERAL.fetchIntervalHours,
      ),
      cleanupDays: clamp(
        getPref("cleanupDays"),
        LIMITS.cleanupDays,
        DEFAULT_GENERAL.cleanupDays,
      ),
      maxNewPerRun: clamp(
        getPref("maxNewPerRun"),
        LIMITS.maxNewPerRun,
        DEFAULT_GENERAL.maxNewPerRun,
      ),
      firstFetchDays: clamp(
        getPref("firstFetchDays"),
        LIMITS.firstFetchDays,
        DEFAULT_GENERAL.firstFetchDays,
      ),
      mailto: String(getPref("mailto") ?? "").trim(),
      // 0 = never chosen: two years back
      earlierFromYear: Math.min(
        new Date().getFullYear(),
        getPref("earlierFromYear")
          ? clamp(
              getPref("earlierFromYear"),
              LIMITS.earlierFromYear,
              DEFAULT_GENERAL.earlierFromYear,
            )
          : DEFAULT_GENERAL.earlierFromYear,
      ),
    },
    journals: journals.value,
    scoring: {
      rules: rules.value,
      authors: authors.value,
      journalBonus: parseJournalBonus(getPref("journalBonus")),
      fieldWeights: {
        title: clamp(
          getPref("titleWeight"),
          LIMITS.weight,
          d.fieldWeights.title,
        ),
        abstract: clamp(
          getPref("abstractWeight"),
          LIMITS.weight,
          d.fieldWeights.abstract,
        ),
      },
      thresholds: {
        high: clamp(getPref("thresholdHigh"), LIMITS.weight, d.thresholds.high),
        possible: clamp(
          getPref("thresholdPossible"),
          LIMITS.weight,
          d.thresholds.possible,
        ),
      },
    },
    warnings: [...journals.warnings, ...rules.warnings, ...authors.warnings],
  };
}

export function saveJournals(journals: Journal[]): void {
  setPref("journals", JSON.stringify(journals));
}

export function saveRules(rules: ScoringSettings["rules"]): void {
  setPref("rules", JSON.stringify(rules));
}

export function saveAuthors(authors: ScoringSettings["authors"]): void {
  setPref("authors", JSON.stringify(authors));
}

export const AI_MAX_PER_RUN_LIMITS = [1, 500] as const;

/** AI settings and the interests paragraph. The API key stays in prefs only. */
export function loadAiSettings(): { ai: AiSettings; interests: string } {
  return {
    ai: {
      enabled: getPref("aiEnabled") === true,
      baseUrl: String(getPref("aiBaseUrl") ?? "").trim(),
      model: String(getPref("aiModel") ?? "").trim(),
      apiKey: String(getPref("aiApiKey") ?? "").trim(),
      reasoningEffort: String(getPref("aiReasoningEffort") ?? "").trim(),
      maxPerRun: clamp(getPref("aiMaxPerRun"), AI_MAX_PER_RUN_LIMITS, 50),
    },
    interests: String(getPref("interests") ?? "").trim(),
  };
}

/** Why the AI cannot run with these settings, or null when it can. */
export function aiNotReady(ai: AiSettings, interests: string): string | null {
  if (!ai.baseUrl || !ai.model)
    return "base URL and model are not set in Settings.";
  if (!/^https?:\/\//i.test(ai.baseUrl))
    return "the base URL must start with http:// or https://.";
  if (!interests) return "add your research interests in Settings first.";
  return null;
}
