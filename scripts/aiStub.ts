import { createServer, type Server } from "node:http";

/**
 * A fake OpenAI-compatible AI server for development and tests. It answers
 * /v1/chat/completions with a fixed-format judgement: 3 if the article title
 * mentions "decline" or "history", else 1. It also records requests, so tests
 * can check exactly what the plugin sends.
 *
 * Run it by hand with: node scripts/aiStub.ts   (listens on localhost:11435)
 * Then set Base URL to http://localhost:11435/v1 and any model name.
 */
export interface StubRequest {
  path: string;
  authorization?: string;
  body: any;
}

export function startStub(
  port = 0,
): Promise<{ server: Server; url: string; requests: StubRequest[] }> {
  const requests: StubRequest[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({
        path: req.url ?? "",
        authorization: req.headers.authorization,
        body,
      });
      if (req.url !== "/v1/chat/completions") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      if (body.model === "rate-limited") {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "quota exceeded" } }));
        return;
      }
      const user: string = body.messages?.[1]?.content ?? "";
      const title = user.match(/Article title: (.*)/)?.[1] ?? "";
      const relevant = /decline|history/i.test(title);
      const answer = {
        score: relevant ? 3 : 1,
        interest: relevant ? "organizational decline" : "",
        reason: relevant
          ? "Directly about firm decline."
          : "Only loosely related.",
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      // Wrapped in a code fence, as real models often do
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "```json\n" + JSON.stringify(answer) + "\n```",
              },
            },
          ],
        }),
      );
    });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const { port: p } = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${p}/v1`, requests });
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startStub(11435).then(({ url }) =>
    console.log(`AI stub listening at ${url}`),
  );
}
