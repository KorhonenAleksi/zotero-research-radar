# Decisions

Short records of structural choices, newest first.

## 2026-10-22 — Journal list: bundled FT50 + Crossref journal search

**Context.** The plugin will be shared, so a hand-typed personal journal list doesn't scale.
FT50 + the Chartered ABS Academic Journal Guide (AJG) was proposed as the starting point.

**Decision.**

- Ship the **FT50 (2026 edition)** as a tick-box catalogue: titles, publishers and
  ISSNs (`src/core/data/ft50.json`). Nothing is pre-selected; each user picks their own.
- Any other journal is added through a **search box backed by Crossref's journal
  search** (`/journals?query=`), which fills in ISSNs automatically. Results show
  publisher and recent article count, because titles collide (Crossref has five
  journals called "Journal of Management").
- **No AJG data in the plugin**, and no list import for now.

**Why not the AJG.** The AJG is "Copyright … All rights reserved" by the Chartered ABS.
Its website terms allow downloading extracts "for your personal use" only, and
forbid reproducing or republishing content and "text or data mining or web
scraping" without a licence. Bundling its titles, fields or ratings in a shared
plugin would breach that. The FT50 list is published openly by the FT and widely
reproduced by university libraries. Titles and ISSNs are factual data.

**Data notes (checked 2026-10-22 against Crossref).**

- The FT50 revision of 29 April 2026 removed Human Relations, Journal of Business Ethics and
  Organization Studies, and added Academy of Management Annals, American Sociological
  Review and Psychological Science. The removed journals remain addable via search.
- Harvard Business Review registers no DOIs with Crossref and is marked RSS-only.
- MIT Sloan Management Review is reported to be ceasing publication; kept while it's on the list.
- Crossref's "electronic" ISSN for Entrepreneurship Theory and Practice (1540-8520)
  fails its check digit. The correct 1540-6520 is used. All ISSNs are now
  checksum-validated, in the catalogue tests and in search results.
