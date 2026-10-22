import { XMLParser } from "fast-xml-parser";
import { normalizeDoi } from "./doi";
import { itemKey } from "./itemKey";
import { cleanAbstract, stripMarkup, wordCount } from "./markup";
import type { Author, Journal, RadarItem } from "./types";

/** Shortest text we accept as an abstract; publisher boilerplate is shorter. */
const MIN_ABSTRACT_WORDS = 30;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep everything as strings: DOIs like 10.1002 must not become numbers
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) =>
    ["item", "entry", "dc:creator", "author", "link"].includes(name),
});

type Node = unknown;

/** Text content of a parsed node (string, {#text}, CDATA, or the first of an array). */
function text(node: Node): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean")
    return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    return text(o["#text"] ?? o["__cdata"] ?? "");
  }
  return "";
}

function all(node: Node): Node[] {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

/** Items from RSS 2.0 (rss > channel > item), RSS 1.0 (rdf:RDF > item) or Atom (feed > entry). */
function rawItems(doc: Record<string, any>): Record<string, any>[] {
  return [
    ...all(doc.rss?.channel?.item),
    ...all(doc["rdf:RDF"]?.item),
    ...all(doc.feed?.entry),
  ] as Record<string, any>[];
}

function atomLink(entry: Record<string, any>): string {
  const links = all(entry.link) as Array<Record<string, string> | string>;
  for (const l of links) {
    if (typeof l === "string") return l;
    if (!l["@_rel"] || l["@_rel"] === "alternate") return l["@_href"] ?? "";
  }
  return "";
}

function findDoi(it: Record<string, any>, link: string): string | undefined {
  const candidates = [
    text(it["prism:doi"]),
    text(it["dc:identifier"]),
    text(it.guid),
    text(it.id),
    link,
  ];
  for (const c of candidates) {
    const d = normalizeDoi(c);
    if (d) return d;
  }
  return undefined;
}

function isoDate(raw: string): string | undefined {
  if (!raw) return undefined;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}

/** "Given Middle Family" → Author; good enough for display and name matching. */
function parseName(name: string): Author | null {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) return null;
  const parts = n.split(" ");
  const family = parts.pop()!;
  return { given: parts.join(" ") || undefined, family };
}

/**
 * Feed authors are messy. Elsevier puts "Author(s): A, B" in the description;
 * Taylor & Francis runs names, affiliations and bios together in one
 * dc:creator. We only accept short, name-like strings and otherwise return
 * none, leaving authors to Crossref.
 */
function feedAuthors(
  it: Record<string, any>,
  rawDescription: string,
): Author[] {
  const elsevier = stripMarkup(rawDescription).match(/Author\(s\):\s*(.+)$/);
  const names = elsevier
    ? elsevier[1].split(/,\s*/)
    : [
        ...all(it["dc:creator"]).map(text),
        ...all(it.author).map((a) => text((a as any)?.name ?? a)),
      ];
  const plausible = (s: string) =>
    s.length > 0 &&
    s.length <= 60 &&
    !/\d|university|department|school|institute|professor/i.test(s);
  const flat = names.flatMap((n) => n.split(/\s*;\s*|\s+and\s+/));
  if (!flat.every(plausible)) return [];
  return flat.map(parseName).filter((a): a is Author => !!a);
}

function pickAbstract(it: Record<string, any>): string | undefined {
  const candidates = [
    it["content:encoded"],
    it["dc:description"],
    it.description,
    it.summary,
    it.content,
  ]
    .map((n) => cleanAbstract(text(n)))
    .filter((s): s is string => !!s)
    // Elsevier's description is metadata, not an abstract
    .filter((s) => !/^Publication date:/i.test(s))
    .sort((a, b) => b.length - a.length);
  const best = candidates[0];
  return wordCount(best) >= MIN_ABSTRACT_WORDS ? best : undefined;
}

/** Parse an RSS 1.0 / RSS 2.0 / Atom feed into items for `journal`. */
export function parseFeed(xml: string, journal: Journal): RadarItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const items: RadarItem[] = [];
  for (const it of rawItems(doc)) {
    const title = stripMarkup(text(it.title) || text(it["dc:title"]));
    if (!title) continue;
    const link = text(it.link) || atomLink(it) || text(it["prism:url"]);
    const doi = findDoi(it, link);
    const abstract = pickAbstract(it);
    items.push({
      key: itemKey(doi, journal.id, title),
      doi,
      title,
      abstract,
      authors: feedAuthors(it, text(it.description)),
      journalId: journal.id,
      journalTitle: journal.title,
      date: isoDate(
        text(it["prism:coverDate"]) ||
          text(it["dc:date"]) ||
          text(it.pubDate) ||
          text(it.published) ||
          text(it.updated),
      ),
      url: link || undefined,
      volume: text(it["prism:volume"]) || undefined,
      issue: text(it["prism:number"]) || undefined,
      sources: ["rss"],
      titleOnly: !abstract,
    });
  }
  return items;
}
