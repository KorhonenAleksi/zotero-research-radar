/** GET a URL and parse JSON. Throws with a short, user-readable message on failure. */
export async function getJson(
  url: string,
  timeoutMs = 20000,
): Promise<unknown> {
  const xhr = await Zotero.HTTP.request("GET", url, {
    responseType: "json",
    timeout: timeoutMs,
    headers: { Accept: "application/json" },
  }).catch((e: any) => {
    throw new Error(
      e?.status ? `HTTP ${e.status}` : "network error (offline?)",
    );
  });
  return xhr.response;
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
