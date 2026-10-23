import { aiSummary, type AiJudgement } from "./ai";
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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The child note attached to each Radar item. Every piece of text from
 * outside (titles, rule labels, matched terms) is escaped.
 */
export function noteHtml(
  result: ScoreResult,
  info: {
    fetchedOn: string;
    sources: string[];
    addedByHand?: boolean;
    ai?: AiJudgement;
    liftedByAi?: boolean;
    /** Found by the initial search for earlier articles. */
    earlier?: boolean;
  },
): string {
  const head = info.liftedByAi
    ? "Research Radar: Possible (found by AI)"
    : `Research Radar: ${TIER_LABEL[result.tier]} (${result.total} points)`;
  const items = result.reasons
    .map((r) => `<li>${escapeHtml(reasonText(r))}</li>`)
    .join("");
  const titleOnly = result.titleOnly
    ? "<p><em>Title-only match: no abstract was available from the publisher.</em></p>"
    : "";
  return [
    `<h2>${escapeHtml(head)}</h2>`,
    items ? `<ul>${items}</ul>` : "",
    titleOnly,
    info.ai
      ? `<p><strong>${escapeHtml(`AI (${info.ai.model}):`)}</strong> ${escapeHtml(aiSummary(info.ai).replace(/^AI /, ""))}</p>`
      : "",
    info.liftedByAi
      ? "<p><em>No keyword rule matched; the AI rated this article as relevant to your interests.</em></p>"
      : "",
    `<p>Found ${escapeHtml(info.fetchedOn)} via ${escapeHtml(info.sources.join(" + "))}${info.earlier ? " by the initial search for earlier articles" : ""}.</p>`,
    info.addedByHand
      ? "<p>You added this article by hand from \u201cAll fetched articles\u201d.</p>"
      : "",
    info.earlier
      ? "<p>To keep this article, add it to one of your own collections. To dismiss it, move it to the Trash. Articles from the initial search stay in Radar/Earlier until you move them, or until they no longer match your settings.</p>"
      : "<p>To keep this article, add it to one of your own collections. To dismiss it, move it to the Trash. Untouched Radar items are cleaned up automatically after the period set in Research Radar's settings.</p>",
  ].join("");
}
