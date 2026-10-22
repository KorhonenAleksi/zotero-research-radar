import { stem, words, type PreparedText } from "./text";

/**
 * Boolean keyword queries, as written by the user in a rule:
 *
 *   "organizational decline" OR "corporate failure"
 *   histor* AND (strategy OR strategic) NOT finance
 *
 * - Words are stemmed, so "declines" finds "declining".
 * - "Quoted phrases" must appear as consecutive words.
 * - A trailing * matches any word starting with that prefix: histor* → historical.
 * - Words next to each other without an operator are ANDed.
 * - Operators must be upper case (AND, OR, NOT); lower-case "and"/"or" are words.
 */
export type QueryNode =
  | { op: "term"; stem: string; text: string }
  | { op: "prefix"; prefix: string; text: string }
  | { op: "phrase"; stems: string[]; text: string }
  | { op: "and" | "or"; children: QueryNode[] }
  | { op: "not"; child: QueryNode };

export class QueryError extends Error {}

type Token =
  | { t: "word"; v: string }
  | { t: "phrase"; v: string }
  | { t: "AND" | "OR" | "NOT" | "(" | ")" };

function tokenize(q: string): Token[] {
  const tokens: Token[] = [];
  // Sticky (y): each token must start exactly where the last one ended, so
  // nothing is silently skipped
  const re = /\s*(?:(\()|(\))|"([^"]*)"|([^\s()"]+))/y;
  let m: RegExpExecArray | null;
  while (re.lastIndex < q.length && (m = re.exec(q)) !== null) {
    if (m[1]) tokens.push({ t: "(" });
    else if (m[2]) tokens.push({ t: ")" });
    else if (m[3] !== undefined) tokens.push({ t: "phrase", v: m[3] });
    else if (m[4] === "AND" || m[4] === "OR" || m[4] === "NOT")
      tokens.push({ t: m[4] });
    else tokens.push({ t: "word", v: m[4] });
  }
  const rest = q.slice(re.lastIndex).trim();
  if (rest.startsWith('"'))
    throw new QueryError("A quotation mark is not closed.");
  return tokens;
}

function leaf(tok: Token & { v: string }): QueryNode {
  if (tok.t === "phrase") {
    const stems = words(tok.v).map(stem);
    if (stems.length === 0) throw new QueryError('Empty phrase "".');
    return { op: "phrase", stems, text: `"${tok.v}"` };
  }
  if (tok.v.endsWith("*")) {
    const [prefix] = words(tok.v.slice(0, -1));
    if (!prefix || prefix.length < 3)
      throw new QueryError(
        `"${tok.v}": a wildcard needs at least 3 letters before *.`,
      );
    return { op: "prefix", prefix, text: tok.v };
  }
  const w = words(tok.v);
  if (w.length === 0) throw new QueryError(`"${tok.v}" contains no letters.`);
  // "socio-economic" written without quotes behaves as a phrase
  if (w.length > 1) return { op: "phrase", stems: w.map(stem), text: tok.v };
  return { op: "term", stem: stem(w[0]), text: tok.v };
}

/** Parse a rule query. Throws QueryError with a user-readable message. */
export function parseQuery(q: string): QueryNode {
  const tokens = tokenize(q);
  if (tokens.length === 0) throw new QueryError("The query is empty.");
  let pos = 0;
  const peek = () => tokens[pos];

  const parseOr = (): QueryNode => {
    const children = [parseAnd()];
    while (peek()?.t === "OR") {
      pos++;
      children.push(parseAnd());
    }
    return children.length === 1 ? children[0] : { op: "or", children };
  };

  const parseAnd = (): QueryNode => {
    const children = [parseNot()];
    for (;;) {
      const t = peek();
      if (!t || t.t === "OR" || t.t === ")") break;
      if (t.t === "AND") pos++;
      children.push(parseNot());
    }
    return children.length === 1 ? children[0] : { op: "and", children };
  };

  const parseNot = (): QueryNode => {
    if (peek()?.t === "NOT") {
      pos++;
      return { op: "not", child: parseNot() };
    }
    return parsePrimary();
  };

  const parsePrimary = (): QueryNode => {
    const t = tokens[pos++];
    if (!t) throw new QueryError("The query ends with an operator.");
    if (t.t === "(") {
      const inner = parseOr();
      if (tokens[pos++]?.t !== ")")
        throw new QueryError("A parenthesis is not closed.");
      return inner;
    }
    if (t.t === "word" || t.t === "phrase") return leaf(t);
    throw new QueryError(`Unexpected ${t.t}.`);
  };

  const node = parseOr();
  if (pos < tokens.length) throw new QueryError(`Unexpected ${tokens[pos].t}.`);
  return node;
}

/** Positive leaves that matched in this text (for the explanation). */
export function matchedTerms(node: QueryNode, text: PreparedText): string[] {
  switch (node.op) {
    case "term":
      return text.stems.includes(node.stem) ? [node.text] : [];
    case "prefix":
      return text.words.some((w) => w.startsWith(node.prefix))
        ? [node.text]
        : [];
    case "phrase":
      return containsSequence(text.stems, node.stems) ? [node.text] : [];
    case "and":
    case "or":
      return [...new Set(node.children.flatMap((c) => matchedTerms(c, text)))];
    case "not":
      return [];
  }
}

function containsSequence(hay: string[], needle: string[]): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++)
      if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Does the query hold for this text? */
export function evaluate(node: QueryNode, text: PreparedText): boolean {
  switch (node.op) {
    case "term":
    case "prefix":
    case "phrase":
      return matchedTerms(node, text).length > 0;
    case "and":
      return node.children.every((c) => evaluate(c, text));
    case "or":
      return node.children.some((c) => evaluate(c, text));
    case "not":
      return !evaluate(node.child, text);
  }
}
