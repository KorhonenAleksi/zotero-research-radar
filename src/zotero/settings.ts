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
