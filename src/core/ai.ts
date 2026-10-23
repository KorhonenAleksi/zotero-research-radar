import { fnv1a } from "./itemKey";
import type { ScoreResult, Tier } from "./rules";
import type { RadarItem } from "./types";

/**
 * Optional AI relevance judgement through any OpenAI-compatible chat
 * endpoint (Gemini, a university endpoint, Ollama, LM Studio). Only the
 * article's title and abstract and the user's own interests paragraph are
 * sent; never library contents, notes or annotations. The AI score sits
 * beside the rule score: it never hides or lowers anything, and only a 2 or
 * 3 lifts an article from Rest to Possible (never past an exclusion rule).
 */

export interface AiSettings {
  enabled: boolean;
  /** e.g. https://generativelanguage.googleapis.com/v1beta/openai/ or http://localhost:11434/v1 */
  baseUrl: string;
  model: string;
  /** Empty for local servers that need no key. */
  apiKey: string;
  /** Optional: sent as reasoning_effort only when set (e.g. "minimal" for Gemini). */
  reasoningEffort: string;
  /** At most this many articles are sent per fetch. */
  maxPerRun: number;
}

export interface AiJudgement {
  score: 0 | 1 | 2 | 3;
  /** Which of the user's interests it relates to (may be empty). */
  interest: string;
  reason: string;
  /** The model only had the title. */
  titleOnly: boolean;
  model: string;
  /** Hash of interests + model: a different value means the judgement is outdated. */
  context: string;
}

export const AI_SYSTEM_PROMPT = `You screen newly published academic articles for one researcher and judge how relevant each article is to their research interests.

Reply with JSON only, no other text:
{"score": <0, 1, 2 or 3>, "interest": "<the interest it relates to, or empty>", "reason": "<one sentence, at most 25 words>"}

Scores:
3 = directly relevant to one of the stated interests; they would want to read it.
2 = clearly related to their interests.
1 = only loosely related.
0 = not relevant.

Judge only from what you are given. If there is no abstract, judge from the title alone and be cautious: give 3 only when the title by itself makes the relevance clear.`;

/** Identifies the interests and model a judgement was made with. */
export function aiContext(interests: string, model: string): string {
  return fnv1a(`${interests.trim()}|${model.trim()}`);
}

export function chatUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
}

/** The request for one article. Only title, abstract and interests are sent. */
export function buildAiRequest(
  item: Pick<RadarItem, "title" | "abstract">,
  interests: string,
  s: AiSettings,
): { url: string; headers: Record<string, string>; body: string } {
  const article = [
    `Article title: ${item.title}`,
    item.abstract
      ? `Abstract: ${item.abstract}`
      : "Abstract: (none available; judge from the title only)",
  ].join("\n");
  const body: Record<string, unknown> = {
    model: s.model.trim(),
    temperature: 0,
    messages: [
      { role: "system", content: AI_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Research interests:\n${interests.trim()}\n\n${article}`,
      },
    ],
  };
  if (s.reasoningEffort.trim())
    body.reasoning_effort = s.reasoningEffort.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (s.apiKey.trim()) headers.Authorization = `Bearer ${s.apiKey.trim()}`;
  return { url: chatUrl(s.baseUrl), headers, body: JSON.stringify(body) };
}

export class AiReplyError extends Error {}

/**
 * Read the model's reply defensively: models sometimes wrap JSON in code
 * fences or add a sentence around it, or give the score as text.
 */
export function parseAiReply(
  response: unknown,
): Pick<AiJudgement, "score" | "interest" | "reason"> {
  const content = (response as any)?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((p: any) => p?.text ?? "").join("")
    : String(content ?? "");
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new AiReplyError("The reply contained no JSON.");
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new AiReplyError("The reply's JSON could not be read.");
  }
  const n = Math.round(Number(data.score));
  if (!Number.isFinite(n) || n < 0 || n > 3)
    throw new AiReplyError("The reply had no score between 0 and 3.");
  const clip = (v: unknown, max: number) => {
    const s = String(v ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };
  return {
    score: n as AiJudgement["score"],
    interest: clip(data.interest, 100),
    reason: clip(data.reason, 240),
  };
}

/** Lowest AI score that lifts a Rest article to Possible. */
export const AI_LIFT_MIN = 2;

/** Tier after the AI's say: a current AI 2 or 3 lifts Rest to Possible, nothing else changes. */
export function effectiveTier(
  score: ScoreResult,
  ai: AiJudgement | undefined,
  currentContext: string | null,
): { tier: Tier; liftedByAi: boolean } {
  const lift =
    !score.excluded &&
    score.tier === "rest" &&
    ai !== undefined &&
    ai.score >= AI_LIFT_MIN &&
    currentContext !== null &&
    ai.context === currentContext;
  return lift
    ? { tier: "possible", liftedByAi: true }
    : { tier: score.tier, liftedByAi: false };
}

/** One line for notes and the All fetched articles window. */
export function aiSummary(ai: AiJudgement): string {
  const about = ai.interest ? ` (${ai.interest})` : "";
  const basis = ai.titleOnly ? " Judged from the title only." : "";
  return `AI ${ai.score}/3${about}: ${ai.reason}${basis}`;
}
