import type { Reason, ScoreResult } from "./rules";

const TIER_LABEL = {
  high: "High",
  possible: "Possible",
  rest: "Rest",
} as const;

function reasonText(r: Reason): string {
  switch (r.kind) {
    case "rule":
      return `${r.field} matched ${r.terms.join(", ")} (${r.label}, +${r.points})`;
    case "author":
      return `author ${r.name}${r.via === "orcid" ? " (ORCID)" : ""} (+${r.points})`;
    case "journal":
      return `journal bonus ${r.journal} (+${r.points})`;
    case "exclude":
      return `excluded by ${r.label}: ${r.terms.join(", ")}`;
  }
}

/** One-line explanation, e.g. "High 7: title matched "decline" (Decline, +3); author Chandler (+5)". */
export function summarize(result: ScoreResult): string {
  const head = result.excluded
    ? "Excluded"
    : `${TIER_LABEL[result.tier]} ${result.total}`;
  const parts = result.reasons.map(reasonText);
  if (result.titleOnly) parts.push("title-only: no abstract available");
  return parts.length ? `${head}: ${parts.join("; ")}` : `${head}: no matches`;
}
