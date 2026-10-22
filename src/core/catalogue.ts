import ft50 from "./data/ft50.json";
import { normalizeIssn } from "./issn";
import type { Journal } from "./types";

interface CatalogueEntry {
  title: string;
  publisher: string;
  issnPrint: string | null;
  issnElectronic: string | null;
  crossref: boolean;
  note?: string;
}

/** Key used to identify a journal across catalogue, search and the user's list. */
export function journalId(
  issnPrint?: string | null,
  issnElectronic?: string | null,
): string | null {
  return normalizeIssn(issnPrint) ?? normalizeIssn(issnElectronic);
}

function fromEntry(entry: CatalogueEntry, list: string): Journal {
  const id = journalId(entry.issnPrint, entry.issnElectronic);
  if (!id) throw new Error(`Catalogue entry without ISSN: ${entry.title}`);
  return {
    id,
    title: entry.title,
    publisher: entry.publisher,
    issnPrint: normalizeIssn(entry.issnPrint) ?? undefined,
    issnElectronic: normalizeIssn(entry.issnElectronic) ?? undefined,
    crossref: entry.crossref,
    source: "catalogue",
    list,
    note: entry.note,
  };
}

/** The bundled FT50 list, as journals the user can tick. */
export function ft50Journals(): Journal[] {
  const list = `${ft50.list} (${ft50.edition})`;
  return ft50.journals.map((e) => fromEntry(e, list));
}

export const ft50Info = {
  list: ft50.list,
  edition: ft50.edition,
  source: ft50.source,
  checked: ft50.checked,
};
