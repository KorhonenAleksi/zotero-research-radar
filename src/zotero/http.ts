/** Waits before retrying when a server says it is busy (429 Too Many Requests, 503). */
const BUSY_RETRY_MS = [2000, 5000, 15000];

/**
 * GET a URL and parse JSON. A busy server is retried a few times with
 * growing pauses (Crossref limits how fast it may be asked). Throws with a
 * short, user-readable message on failure.
 */
export async function getJson(
  url: string,
  timeoutMs = 20000,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const xhr = await Zotero.HTTP.request("GET", url, {
        responseType: "json",
        timeout: timeoutMs,
        headers: { Accept: "application/json" },
      });
      return xhr.response;
    } catch (e: any) {
      const status = Number(e?.status) || 0;
      if (
        (status === 429 || status === 503) &&
        attempt < BUSY_RETRY_MS.length
      ) {
        await Zotero.Promise.delay(BUSY_RETRY_MS[attempt]);
        continue;
      }
      throw new Error(status ? `HTTP ${status}` : "network error (offline?)", {
        cause: e,
      });
    }
  }
}

/** GET a URL as text (feeds). */
export async function getText(url: string, timeoutMs = 20000): Promise<string> {
  const xhr = await Zotero.HTTP.request("GET", url, {
    responseType: "text",
    timeout: timeoutMs,
  }).catch((e: any) => {
    throw new Error(
      e?.status ? `HTTP ${e.status}` : "network error (offline?)",
    );
  });
  return xhr.responseText ?? "";
}
