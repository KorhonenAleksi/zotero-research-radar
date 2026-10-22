// Default preferences. List-valued settings are JSON strings, validated on read
// (see src/core/settings.ts).
pref("autoFetch", false);
pref("fetchIntervalHours", 12);
pref("cleanupDays", 30);
pref("maxNewPerRun", 15);
pref("firstFetchDays", 30);
pref("mailto", "");
pref("journals", "[]");
pref("rules", "[]");
pref("authors", "[]");
pref("journalBonus", "{}");
pref("titleWeight", 3);
pref("abstractWeight", 1);
pref("thresholdHigh", 5);
pref("thresholdPossible", 1);
// Ids of the Radar collections in the user library, set on first use
pref("collectionRadar", 0);
pref("collectionHigh", 0);
pref("collectionPossible", 0);
pref("lastRun", "");
// One-time repair of "&amp;" in journal names written by 0.6.0 and earlier
pref("repairedEscapedTitles", false);
// Result lines of the last fetch, shown in the settings pane (JSON list)
pref("lastRunSummary", "[]");
// Plain-language research interests, for the optional AI ranking
pref("interests", "");
// Optional AI ranking (any OpenAI-compatible endpoint). Off by default.
pref("aiEnabled", false);
pref("aiBaseUrl", "");
pref("aiModel", "");
pref("aiApiKey", "");
pref("aiReasoningEffort", "");
pref("aiMaxPerRun", 50);
