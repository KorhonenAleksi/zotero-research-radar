# Research Radar

A Zotero 9/10 plugin that fetches newly published articles from the journals
you follow, ranks each one **High / Possible / Rest** against your own keyword
rules and watched authors, and files the matches into a **Radar** collection
in your library, with a note explaining why each one matched. It works fully
without AI; AI ranking is an optional extra.

Status: **test version (0.x)**. It writes items into your library, so please
read "What it changes in your library" below before the first fetch, and
back up your library before installing.

## Before you install: back up your Zotero library

This is a test version that adds items to your library, so make a backup
first. It takes a few minutes and lets you undo anything.

1. Find your Zotero data folder: in Zotero, open Settings (macOS: Zotero →
   Settings; Windows/Linux: Edit → Settings) → Advanced → Files and Folders →
   **Show Data Directory**. By default it is the `Zotero` folder in your home
   folder.
2. **Quit Zotero completely.** Copying the database while Zotero is running
   can give a broken copy.
3. Copy the **whole** data folder (it contains `zotero.sqlite`, your library,
   and `storage`, your PDFs) to another place, such as an external drive or a
   cloud folder. Give the copy a date, e.g. `Zotero backup 2026-10-23`.

Zotero sync is not a backup: if items are trashed or changed, sync copies that
change to your other devices and to zotero.org.

To restore: quit Zotero, rename the current data folder (e.g. to
`Zotero old`), copy the backup into its place under the original name, and
start Zotero. If you use Zotero sync, turn off automatic sync before starting
Zotero, otherwise it may pull the newer changes back from zotero.org; the
Reset options under Settings → Sync can then replace the online library with
your restored copy (see the
[Zotero documentation](https://www.zotero.org/support/zotero_data#backing_up_your_zotero_data)).

## Install

Requires Zotero 9 or 10. Back up your library first (see above).

1. Download `research-radar.xpi` from the latest
   [release](https://github.com/KorhonenAleksi/research-radar/releases/latest).
2. In Zotero: Tools → Plugins → gear icon → Install Plugin From File…, and
   pick the downloaded file.

Zotero checks for new versions automatically. Updates keep your settings and
Radar items.

## First-time setup

Open Zotero Settings → **Research Radar**.

1. **Journals.** Tick journals in the FT50 list, or search Crossref for any
   other journal by title. Articles are fetched from Crossref by ISSN; an RSS
   feed URL is optional and mainly adds abstracts some publishers don't send
   to Crossref.
2. **Keyword rules.** One rule per line of interest, e.g.
   `"organizational decline" OR turnaround`. Words match in any form
   (decline, declining) and in British or American spelling. Use "quotes" for
   phrases, AND / OR / NOT in capitals, brackets, and `*` for word families
   (`histor*` matches history and historical). Title matches count 3× abstract
   matches by default.
3. **Watched authors.** Add an ORCID iD for exact matching; without one,
   family name plus first initial is used.
4. Optional: your **email** under Options. It is sent to Crossref only, as
   their "polite pool" asks, which gives faster and more reliable responses.

Then run **Tools → Research Radar: Fetch now**. The first fetch looks back 30
days and writes at most 15 new items. Automatic fetching (on startup and every
12 hours) is **off** until you tick it under Options.

Optional, once: the **initial search** (see below) also looks through your
journals' earlier articles.

Shortcut: **Set up with AI** at the top of the settings pane gives you a prompt
to paste into an AI assistant together with your research notes; it drafts
journals, rules and authors into a profile file you then import. You see a
preview first, and importing only adds to your settings.

## Daily use

- **Radar → High / Possible** in your library hold the matches. Each item has
  the tags `radar` and `radar:high` or `radar:possible`, and a child note with
  the score and the matched terms or author.
- **Keep** an article by adding it to any of your own collections, or by
  adding a note or attachment to it.
- **Dismiss** it by moving it to the Trash.
- **Tools → Research Radar: All fetched articles…** lists everything fetched,
  including the Rest tier, with filters by tier and journal, sorting by
  points or AI rating, and an **Add article to library** button.
- **Right-click** any article for: Watch an author…, Follow this journal, Make
  a rule from this article….
- A pop-up after each fetch reports how many new High and Possible matches
  were found.
- If you change your rules, untouched Radar items that no longer match are
  moved to the Trash at the next fetch. They stay listed in All fetched
  articles and can be added back.

## Initial search for earlier articles

Regular fetches only look at new articles. To also catch relevant articles
from earlier years, open Settings → Research Radar → **Initial search**,
choose a start year (default: two years back) and click **Run initial
search**.

- Every article your journals have published since that year is added to
  **All fetched articles**, marked **Earlier** (use the New / Earlier filter
  there). This can be thousands of articles and take several minutes.
- Only the strongest go into your library, in **Radar/Earlier** (tag
  `radar:earlier`): High keyword matches, and keyword matches the AI rates
  2–3 if AI ranking is on. At most 50 are added per fetch; the rest follow at
  later fetches. Radar/Earlier is never cleaned up by age.
- The AI rates only the earlier articles that matched a keyword rule, after
  each fetch's new articles. You can raise "Max articles sent per fetch" to
  get through them faster.
- Added journals later? Run it again; articles already found are skipped.

## What it changes in your library

- It creates the collections **Radar**, **Radar/High** and **Radar/Possible**
  in My Library (never in group libraries), plus **Radar/Earlier** if you run
  the initial search, and adds journal-article items there. Articles already
  in your library (same DOI) are not added again.
- Items you haven't kept are moved to the **Trash** after 30 days (setting
  under Options; 0 = never; not for Radar/Earlier), or at the next fetch if
  they no longer match your settings. Nothing is ever deleted permanently,
  and an item you have filed elsewhere, annotated or given an attachment is
  never trashed.
- **Tools → Research Radar: Remove untouched Radar items…** trashes every
  Radar item you haven't kept, if you want to start over.
- Radar items sync like any other item, so you can review them on the iPad or
  phone apps.
- Its own bookkeeping (everything fetched, scores) lives in a separate file,
  `researchradar.sqlite`, in your Zotero data folder; Zotero's own database is
  not touched by it. Uninstalling the plugin leaves your items as they are.

## Optional AI ranking

Off by default. Under **AI ranking**, enter any OpenAI-compatible endpoint
(presets for Gemini, Ollama and LM Studio), a model and your own API key, and
write a few sentences about your research under **Research interests**. The AI
rates each new article 0–3 (3 = directly relevant, 2 = clearly related,
1 = loosely related, 0 = not relevant). The rating is shown next to the keyword
score, in the AI column of All fetched articles, and an article rated 2 or 3
moves to Radar/Possible even if no rule matched. It never hides or lowers
anything. Up to 50 articles are rated per fetch (setting), so a large first
fetch is rated over a few fetches.

What is sent: the article's title and abstract and your interests paragraph.
Never anything from your library, notes or annotations. The API key is stored
in Zotero's settings on your computer only; it is not synced. If the endpoint
can't be reached (for example off the university VPN), Research Radar falls
back to the keyword scores without complaint.

## What leaves your computer

- Requests to Crossref (`api.crossref.org`) for each followed journal, with
  your email only if you entered one.
- Requests to the RSS feed URLs you added.
- If AI ranking is on: titles, abstracts and your interests paragraph to the
  endpoint you configured.

Nothing else, and no data is sent to the plugin's author.

## Known limitations

- Abstracts depend on the publisher. Some deposit few abstracts with
  Crossref, so their articles are matched on the title alone unless you add
  the journal's RSS feed.
- Harvard Business Review registers no DOIs, so it works only through its RSS
  feed.
- Fetching runs only while Zotero is open.

## Reporting problems

Please open an [issue](https://github.com/KorhonenAleksi/research-radar/issues)
or contact me. Useful to include: Zotero version, what you did, and the result
lines from the top of the Research Radar settings pane. For errors, Help →
Debug Output Logging → Enable, reproduce the problem, then Submit and send the
Debug ID.

## Development

```sh
npm install
npm test            # unit tests for the pure core (src/core), runs in Node
npm run build       # → build/research-radar.xpi
npm start           # hot-reload into a separate dev Zotero profile (needs .env, see .env.example)
npm run release     # bump the version, tag and push; GitHub Actions then
                    # publishes the release (.xpi) and update.json
```

Layout: `src/core/` is pure TypeScript with no Zotero dependency and is
unit-tested. `src/zotero/` holds thin adapters to Zotero's API. `addon/` holds
static plugin files. `docs/decisions.md` records structural choices.

Built on [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template). Licensed AGPL-3.0-or-later.
