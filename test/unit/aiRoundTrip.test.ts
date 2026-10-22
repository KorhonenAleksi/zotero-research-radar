import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildAiRequest,
  parseAiReply,
  type AiSettings,
} from "../../src/core/ai";
import { startStub, type StubRequest } from "../../scripts/aiStub.ts";

/** Real HTTP round trip: plugin request → stub server → plugin reply parser. */
describe("AI round trip against the stub server", () => {
  let stub: Awaited<ReturnType<typeof startStub>>;
  beforeAll(async () => {
    stub = await startStub();
  });
  afterAll(() => stub.server.close());

  const settings = (): AiSettings => ({
    enabled: true,
    baseUrl: stub.url + "/",
    model: "stub-model",
    apiKey: "sk-test",
    reasoningEffort: "",
    maxPerRun: 50,
  });

  async function send(title: string, s = settings()) {
    const req = buildAiRequest({ title }, "Organizational decline.", s);
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
    });
    return { status: res.status, json: await res.json() };
  }

  it("gets and parses a judgement, sending exactly what we expect", async () => {
    const { status, json } = await send(
      "Corporate decline in Nordic shipbuilding",
    );
    expect(status).toBe(200);
    expect(parseAiReply(json)).toEqual({
      score: 3,
      interest: "organizational decline",
      reason: "Directly about firm decline.",
    });
    const last: StubRequest = stub.requests.at(-1)!;
    expect(last.path).toBe("/v1/chat/completions");
    expect(last.authorization).toBe("Bearer sk-test");
    expect(last.body.messages).toHaveLength(2);
    expect(last.body.messages[1].content).toContain(
      "Abstract: (none available",
    );
  });

  it("surfaces quota errors as HTTP 429 with the provider's message", async () => {
    const { status, json } = await send("x", {
      ...settings(),
      model: "rate-limited",
    });
    expect(status).toBe(429);
    expect(json.error.message).toBe("quota exceeded");
  });
});
