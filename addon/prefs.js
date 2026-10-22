// Default preferences. List-valued settings are JSON strings, validated on read
// (see src/core/settings.ts).
pref("autoFetch", false);
pref("fetchIntervalHours", 12);
pref("cleanupDays", 30);
pref("maxNewPerRun", 30);
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
// Result lines of the last fetch, shown in the settings pane (JSON list)
pref("lastRunSummary", "[]");
