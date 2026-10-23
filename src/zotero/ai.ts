import {
  aiContext,
  AI_LIFT_MIN,
  AiReplyError,
  buildAiRequest,
  parseAiReply,
  type AiJudgement,
  type AiSettings,
} from "../core/ai";
import { mapPool } from "../core/fetchPlan";
import type { Store, StoredItem } from "../core/store";
import { shouldStop } from "./stopFlag";
import type { RadarItem } from "../core/types";

const TIMEOUT_MS = 60000;
const CONCURRENCY = 2;

/** A problem with the endpoint as a whole: stop asking for this run. */
export class AiStop extends Error {}

function stopMessage(status: number, body: any): string {
  // Providers put a readable message here (Gemini, OpenAI, Ollama); never the key
  const detail = String(body?.error?.message ?? body?.[0]?.error?.message ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 160);
  const extra = detail ? ` (${detail})` : "";
  if (status === 0) return "endpoint unreachable (offline or VPN?)";
  if (status === 401 || status === 403)
    return `the API key was rejected${extra}`;
  if (status === 404)
    return `endpoint or model not found: check base URL and model${extra}`;
  if (status === 429)
    return `rate limit or quota reached; will continue next fetch${extra}`;
  return `HTTP ${status}${extra}`;
}

/** Ask the endpoint about one article. Throws AiStop for endpoint problems, AiReplyError for a bad reply. */
export async function judgeArticle(
  item: Pick<RadarItem, "title" | "abstract">,
  interests: string,
  ai: AiSettings,
): Promise<AiJudgement> {
  const req = buildAiRequest(item, interests, ai);
  let xhr: XMLHttpRequest;
  try {
    xhr = await Zotero.HTTP.request("POST", req.url, {
      body: req.body,
      headers: req.headers,
      responseType: "json",
      timeout: TIMEOUT_MS,
      successCodes: false,
    });
  } catch (e: any) {
    // Network failure or timeout. The error may carry request details, so only its status is used
    throw new AiStop(stopMessage(Number(e?.status) || 0, null));
  }
  if (xhr.status < 200 || xhr.status >= 300)
    throw new AiStop(stopMessage(xhr.status, xhr.response));
  const parsed = parseAiReply(xhr.response);
  return {
    ...parsed,
    titleOnly: !item.abstract,
    model: ai.model,
    context: aiContext(interests, ai.model),
  };
}

/**
 * Judge articles, two at a time. The first endpoint problem stops the rest
 * (they are retried on a later fetch); a single unreadable reply only skips
 * that article. Never throws.
 */
export async function judgeStoredItems(
  store: Store,
  items: StoredItem[],
  interests: string,
  ai: AiSettings,
): Promise<{ judged: number; relevant: number; skipped?: string }> {
  let judged = 0;
  let relevant = 0;
  let stopped: string | undefined;
  let badReplies = 0;
  await mapPool(items, CONCURRENCY, async (s) => {
    if (stopped || shouldStop()) return;
    try {
      const j = await judgeArticle(s.item, interests, ai);
      await store.saveAiJudgement(s.item.key, j);
      judged++;
      if (j.score >= AI_LIFT_MIN) relevant++;
    } catch (e) {
      if (e instanceof AiStop) stopped ??= e.message;
      else if (e instanceof AiReplyError) badReplies++;
      else {
        Zotero.logError(e as Error);
        stopped ??= "unexpected error (see Zotero's error console)";
      }
    }
  });
  const skipped =
    stopped ??
    (badReplies
      ? `${badReplies} repl${badReplies === 1 ? "y" : "ies"} could not be read; will retry next fetch`
      : undefined);
  if (skipped) Zotero.debug(`[Research Radar] AI: ${skipped}`);
  return { judged, relevant, skipped };
}
