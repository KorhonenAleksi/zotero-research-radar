# Research Radar

A Zotero 9/10 plugin that fetches new articles from a list of journals (RSS + Crossref),
ranks every one into **High / Possible / Rest** with an explanation, and files matches
into a synced **Radar** collection. It works fully without AI.

Status: early development (MVP milestone). See `docs/brief.md` for the goals and
the approved plan for the build order.

## Development

```sh
npm install
npm test            # unit tests for the pure core (src/core), runs in Node
npm run build       # → .scaffold/build/research-radar.xpi
npm start           # hot-reload into a separate dev Zotero profile (needs .env, see .env.example)
```

Layout: `src/core/` is pure TypeScript with no Zotero dependency and is unit-tested.
`src/zotero/` holds thin adapters to Zotero's API. `addon/` holds static plugin files.

Built on [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template). Licensed AGPL-3.0-or-later.
