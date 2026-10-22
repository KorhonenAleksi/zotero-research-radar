import { describe, expect, it } from "vitest";
import {
  aiContext,
  aiSummary,
  buildAiRequest,
  effectiveTier,
  parseAiReply,
  type AiJudgement,
  type AiSettings,
} from "../../src/core/ai";
import type { ScoreResult } from "../../src/core/rules";

const gemini: AiSettings = {
  enabled: true,
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
  model: "gemini-3.5-flash-lite",
  apiKey: "test-key-not-real",
  reasoningEffort: "minimal",
  maxPerRun: 50,
};

const reply = (content: unknown) => ({ choices: [{ message: { content } }] });

describe("buildAiRequest", () => {
  const interests = "Business history of Nordic firms; organizational decline.";

  it("targets the chat endpoint with a Bearer key and the chosen model", () => {
    const r = buildAiRequest({ title: "A paper" }, interests, gemini);
    expect(r.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(r.headers.Authorization).toBe("Bearer test-key-not-real");
    const body = JSON.parse(r.body);
    expect(body).toMatchObject({
      model: "gemini-3.5-flash-lite",
      temperature: 0,
      reasoning_effort: "minimal",
    });
  });

  it("sends only the title, abstract and interests", () => {
    const r = buildAiRequest(
      {
        title: "Civilising business",
        abstract: "We study US business schools.",
      },
      interests,
      gemini,
    );
    const user = JSON.parse(r.body).messages[1].content;
    expect(user).toBe(
      `Research interests:\n${interests}\n\nArticle title: Civilising business\nAbstract: We study US business schools.`,
    );
  });

  it("says when there is no abstract", () => {
    const user = JSON.parse(
      buildAiRequest({ title: "Placing history" }, interests, gemini).body,
    ).messages[1].content;
    expect(user).toContain("(none available; judge from the title only)");
  });

  it("omits the key and reasoning effort for local servers", () => {
    const r = buildAiRequest({ title: "x" }, interests, {
      ...gemini,
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      reasoningEffort: "",
    });
    expect(r.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(r.headers.Authorization).toBeUndefined();
    expect(JSON.parse(r.body).reasoning_effort).toBeUndefined();
  });
});

describe("parseAiReply", () => {
  it("reads plain JSON", () => {
    expect(
      parseAiReply(
        reply(
          '{"score": 3, "interest": "decline", "reason": "On firm failure."}',
        ),
      ),
    ).toEqual({ score: 3, interest: "decline", reason: "On firm failure." });
  });

  it("copes with code fences, surrounding text and a score given as text", () => {
    expect(
      parseAiReply(
        reply(
          'Sure! ```json\n{"score": "2", "interest": "", "reason": "Related."}\n```',
        ),
      ).score,
    ).toBe(2);
  });

  it("accepts content given as parts", () => {
    expect(
      parseAiReply(reply([{ type: "text", text: '{"score":1,"reason":"x"}' }])),
    ).toMatchObject({ score: 1, interest: "" });
  });

  it("shortens over-long reasons", () => {
    const r = parseAiReply(
      reply(JSON.stringify({ score: 1, reason: "word ".repeat(100) })),
    );
    expect(r.reason.length).toBeLessThanOrEqual(240);
  });

  it("rejects replies without a usable score", () => {
    expect(() => parseAiReply(reply("I think it is relevant."))).toThrow(
      /no JSON/,
    );
    expect(() => parseAiReply(reply('{"score": 7}'))).toThrow(
      /between 0 and 3/,
    );
    expect(() => parseAiReply(reply("{oops}"))).toThrow(/could not be read/);
    expect(() => parseAiReply({})).toThrow();
  });
});

describe("effectiveTier", () => {
  const score = (tier: ScoreResult["tier"], excluded = false): ScoreResult => ({
    tier,
    total: 0,
    excluded,
    titleOnly: true,
    components: { rules: 0, authors: 0, journal: 0 },
    reasons: [],
  });
  const ctx = aiContext("my interests", "gemini-3.5-flash-lite");
  const ai = (s: AiJudgement["score"], context = ctx): AiJudgement => ({
    score: s,
    interest: "",
    reason: "",
    titleOnly: true,
    model: "m",
    context,
  });

  it("lifts Rest to Possible only on a current AI 3", () => {
    expect(effectiveTier(score("rest"), ai(3), ctx)).toEqual({
      tier: "possible",
      liftedByAi: true,
    });
    expect(effectiveTier(score("rest"), ai(2), ctx).tier).toBe("rest");
    expect(effectiveTier(score("rest"), ai(3, "old"), ctx).tier).toBe("rest");
    expect(effectiveTier(score("rest"), ai(3), null).tier).toBe("rest");
  });

  it("never lowers a tier and never overrides an exclusion rule", () => {
    expect(effectiveTier(score("high"), ai(0), ctx).tier).toBe("high");
    expect(effectiveTier(score("rest", true), ai(3), ctx).tier).toBe("rest");
  });

  it("context changes when interests or model change", () => {
    expect(aiContext("a", "m")).not.toBe(aiContext("b", "m"));
    expect(aiContext("a", "m")).not.toBe(aiContext("a", "n"));
    expect(aiContext(" a ", "m")).toBe(aiContext("a", "m"));
  });

  it("summarises for notes", () => {
    expect(
      aiSummary({ ...ai(3), interest: "decline", reason: "On firm failure." }),
    ).toBe("AI 3/3 (decline): On firm failure. Judged from the title only.");
  });
});
