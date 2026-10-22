const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1].toLowerCase() === "x"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * Plain text from HTML / JATS markup: tags removed, entities decoded,
 * whitespace collapsed. Block-level tags become spaces so words don't merge.
 */
export function stripMarkup(s: string | null | undefined): string {
  if (!s) return "";
  // Feeds sometimes escape the markup itself (&lt;p&gt;), so decode first
  let text = /&lt;\/?[a-z]/i.test(s) ? decodeEntities(s) : s;
  text = text.replace(/<[^>]*>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/**
 * Abstract text with the boilerplate heading removed. Wiley and Crossref often
 * start with "Abstract" (and SMJ with "Research Summary"); keep section labels
 * inside the text but drop the leading "Abstract".
 */
export function cleanAbstract(
  s: string | null | undefined,
): string | undefined {
  const text = stripMarkup(s).replace(/^abstract[:.]?\s+/i, "");
  return text || undefined;
}

export function wordCount(s: string | undefined): number {
  return s ? s.split(/\s+/).filter(Boolean).length : 0;
}
