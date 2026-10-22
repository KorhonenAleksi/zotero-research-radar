import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_SETUP_PROMPT } from "../../src/core/aiSetupPrompt";
import { previewProfile } from "../../src/core/profile";
import { parseQuery } from "../../src/core/query";
import { promptDoc } from "../../scripts/promptDoc.ts";

const empty = { journals: [], rules: [], authors: [] };

/** The example JSON embedded in the prompt, exactly as the AI is shown it. */
function exampleFromPrompt(): string {
  const start = AI_SETUP_PROMPT.indexOf('{\n  "format"');
  const end = AI_SETUP_PROMPT.indexOf("\n}\n", start) + 2;
  return AI_SETUP_PROMPT.slice(start, end);
}

describe("AI setup prompt", () => {
  it("contains an example profile that the importer accepts", () => {
    const p = previewProfile(exampleFromPrompt(), empty);
    expect(p.warnings).toEqual([]);
    expect(p.journals[0]).toMatchObject({
      id: "0007-6791",
      title: "Business History",
    });
    expect(p.rules[0]).toMatchObject({ label: "Decline", weight: 2 });
    expect(p.authors[0]).toMatchObject({ family: "Chandler", weight: 5 });
  });

  it("only shows query examples that parse", () => {
    for (const q of [
      '"organizational decline"',
      "(decline OR failure) AND firm*",
      "histor*",
      '"organizational decline" OR "corporate failure" OR turnaround*',
    ])
      expect(() => parseQuery(q), q).not.toThrow();
  });

  it("docs/ai-setup-prompt.md is up to date (run npm run docs:prompt)", () => {
    const doc = readFileSync(
      new URL("../../docs/ai-setup-prompt.md", import.meta.url),
      "utf8",
    );
    expect(doc).toBe(promptDoc());
  });
});

describe("previewProfile", () => {
  const profile = JSON.stringify({
    format: "research-radar-profile",
    version: 1,
    interests: "  Business history of Nordic firms.  ",
    journals: [
      { title: "Business History", issnPrint: "0007-6791", why: "x" },
      { title: "Strategic Management Journal", issnPrint: "0143-2095" },
      { title: "Made-up Journal", issnPrint: "1234-5678" },
    ],
    rules: [
      { label: "Decline", query: '"organizational decline"', weight: 2 },
      { label: "Broken", query: "(decline", weight: 1 },
      { label: "History", query: "histor*", weight: 1 },
    ],
    authors: [
      { family: "Chandler", given: "Alfred", weight: 5 },
      { family: "Penrose", given: "Edith", orcid: "0000-0000-0000-0000" },
    ],
  });

  it("adds new entries, skips duplicates and explains every skip", () => {
    const current = {
      journals: [
        {
          id: "0143-2095",
          title: "Strategic Management Journal",
          crossref: true,
          source: "catalogue" as const,
        },
      ],
      rules: [{ id: "rule-1", query: "histor*", weight: 1 }],
      authors: [{ id: "author-1", family: "Chandler", given: "A.", weight: 5 }],
    };
    const p = previewProfile(profile, current);
    expect(p.journals.map((j) => j.title)).toEqual(["Business History"]);
    expect(p.journals[0]).toMatchObject({
      source: "manual",
      list: "AI profile",
    });
    expect(p.rules).toEqual([
      expect.objectContaining({ id: "rule-2", label: "Decline", weight: 2 }),
    ]);
    expect(p.authors).toEqual([]);
    expect(p.duplicates).toEqual({ journals: 1, rules: 1, authors: 1 });
    expect(p.interests).toBe("Business history of Nordic firms.");
    expect(p.warnings).toEqual([
      '"Made-up Journal" has neither a valid ISSN nor a feed URL and was skipped.',
      'Rule "Broken" was skipped: A parenthesis is not closed.',
      'Penrose: "0000-0000-0000-0000" is not a valid ORCID iD.',
    ]);
  });

  it("rejects files that are not profiles", () => {
    expect(() => previewProfile("nope", empty)).toThrow(/not valid JSON/);
    expect(() => previewProfile('{"journals": []}', empty)).toThrow(
      /Not a Research Radar profile/,
    );
    expect(() =>
      previewProfile(
        '{"format": "research-radar-profile", "version": 9}',
        empty,
      ),
    ).toThrow(/newer version/);
  });

  it("accepts a file saved with a byte-order mark", () => {
    expect(() => previewProfile("\uFEFF" + profile, empty)).not.toThrow();
  });
});
