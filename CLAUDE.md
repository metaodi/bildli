# CLAUDE.md

Guidance for AI assistants working in the **Bildli** repository.

## What this project is

Bildli is a **static web app** that shows football (soccer) players as Panini-style
collectible cards for children. Kids pick a league (competition), then a team, then
flip through interactive player cards. The UI text is in **Swiss German** (de-CH);
keep user-facing strings in German.

The site is generated entirely from committed **Markdown files** and deployed to
GitHub Pages. There is no runtime backend and no database — the build reads Markdown,
the deploy uploads static HTML.

Two external data sources feed the Markdown (only during content sync, never at build
time):
- **football-data.org** (v4 REST API, free tier) — competitions, teams, squads.
- **Wikidata / Wikimedia Commons** (SPARQL + `w/api.php`) — player images, height,
  preferred foot, birthplace, German team names, and a player fallback when the API
  returns no squad.

## Key architectural rule

**The build never touches the network.** `npm run build` (site generation) reads only
the committed Markdown under `content/`. Fetching/enriching from external APIs is a
*separate*, explicit step (`npm run sync:content`) that rewrites Markdown files. Keep
this separation intact — do not add API calls to `build-site.js`, and do not make the
build depend on `data/` being pre-populated (it regenerates `data/` itself).

## Commands

```bash
npm install                                   # install deps (gray-matter, handlebars)

npm run build                                 # = build:site — generate dist/ from content/ (offline)
npm run build:site                            # node scripts/build-site.js

FOOTBALL_DATA_API_KEY=<key> npm run sync:content   # fetch + scaffold + enrich Markdown (network, slow)
npm run fetch                                  # node scripts/build.js     — football-data.org sync
npm run scaffold                               # node scripts/scaffold.js  — Wikidata squads for curated-team leagues
npm run enrich                                 # node scripts/enrich.js    — Wikidata enrichment

# Optional filter for sync (single competition instead of all auto_update ones):
COMPETITION_FILTER=BL1 npm run sync:content
```

There is **no test runner, linter, or formatter** configured. Node >= 18 is required
(`engines` in `package.json`); CI uses Node 20. Dependencies are intentionally minimal.

To preview the built site, serve `dist/` with any static file server (e.g.
`npx http-server dist` or `python3 -m http.server -d dist`).

## Repository layout

```text
bildli/
├── .github/workflows/
│   ├── build-deploy.yml     # build dist/ + deploy to GitHub Pages (push to main / manual)
│   └── update-content.yml   # run sync:content, commit Markdown (Mondays 06:00 UTC / manual)
├── content/                 # SOURCE OF TRUTH — Markdown with YAML frontmatter (committed)
│   ├── competitions/<CODE>.md
│   ├── teams/<CODE>/<teamId>[-<slug>].md
│   └── players/<CODE>/<teamId>/<playerId>[-<slug>].md
├── images/                  # static images copied verbatim into dist/images/
├── scripts/
│   ├── content.js           # shared helpers: frontmatter I/O, normalization, paths, loadContentData()
│   ├── build.js             # `fetch`  — football-data.org → Markdown
│   ├── squad.js             # shared: fetch a team's current squad (Wikipedia roster / Wikidata)
│   ├── scaffold.js          # `scaffold` — Wikidata squads → player skeletons (curated-team leagues)
│   ├── enrich.js            # `enrich` — Wikidata → Markdown
│   ├── wikidata.js          # shared SPARQL / Wikidata HTTP helpers
│   └── build-site.js        # `build`  — Markdown → static HTML in dist/
├── src/
│   ├── templates/           # Handlebars templates + partials (partials start with _)
│   ├── style.css            # copied to dist/assets/style.css
│   └── app.js               # client JS (card flip modal, image fallback) → dist/assets/app.js
├── data/                    # GENERATED JSON (gitignored, recreated each build)
└── dist/                    # GENERATED static site (gitignored)
```

`data/` and `dist/` are in `.gitignore` — never commit them. `content/` **is** committed
and is the only thing the build reads.

## Content model (the important part)

Everything is a Markdown file with **YAML frontmatter** (parsed by `gray-matter`). The
optional body text below the frontmatter is loaded as a `description`.

Three entity types, nested by directory:
- **Competition** `content/competitions/<CODE>.md` — `code`, `name`, `country`, `flag`
  (emoji), `sortOrder`, `emblem`, `season`.
- **Team** `content/teams/<CODE>/<teamId>-<slug>.md` — `id`, `competitionCode`, `name`,
  `crest`, `coach`, etc.
- **Player** `content/players/<CODE>/<teamId>/<playerId>-<slug>.md` — `id`, `teamId`,
  `competitionCode`, `name`, `position`/`positionOriginal`, `dateOfBirth`, `nationality`,
  `shirtNumber`, plus enriched `image`, `heightCm`, `preferredFoot`, `birthPlace`.

### Two control flags govern all behavior

- **`auto_update`** (default `true`) — whether sync scripts may overwrite this file's
  generated fields.
  - `true`: the sync job refreshes generated fields from the APIs (but always preserves
    the control flags `auto_update`, `visible`, `sortOrder`).
  - `false`: file is **curated**; sync never overwrites its frontmatter. Use this to
    protect hand-edited data.
- **`visible`** — whether the entity appears on the built site.
  - Competitions/teams default to **visible unless `visible: false`**.
  - **Players default to hidden** — `normalizePlayer` treats `visible` as `true` *only*
    when explicitly set (`data.visible === true`). A player without `visible: true` is
    not rendered.
  - Sync sets `visible: false` (never deletes) on auto-updated entities the API no longer
    returns (`markMissingDocsInvisible`).

### Filenames and IDs

- Filenames are `<id>.md` or `<id>-<slug>.md`; the site build and doc lookups match by
  the numeric/id **stem** (`findDocByIdInDir` matches `id` or `id-…`). When you rename an
  entity, sync writes the new slugged filename and deletes the old file.
- `slugify()` in `content.js` transliterates German umlauts (ä→ae, ö→oe, ü→ue, ß→ss)
  before slugging. Reuse it — don't hand-roll slugs.
- Curated entities may use **string IDs** (e.g. the `SSL` Super League team `fcz` and
  players `fcz1`, `fcz7`). football-data.org's free tier doesn't serve `SSL`, so its
  `fetch` request fails and is skipped — its **teams are committed by hand**, and their
  **squads are scaffolded from Wikipedia/Wikidata** (see `squadSource` below).
  Scaffold-created players get `wd-<QID>` IDs.

### Adding content

- **New auto-updated league**: add only `content/competitions/<CODE>.md` with
  `auto_update: true` and a `code` that football-data.org exposes at
  `/competitions/<CODE>/teams`. Then `npm run sync:content` generates the team and
  player files.
- **New curated league/team/player**: create the Markdown files yourself with
  `auto_update: false`; set `visible: true` on players you want shown.
- **League football-data.org doesn't serve** (e.g. `SSL`): commit the competition and
  each `content/teams/<CODE>/…` team file by hand (`auto_update: true`), and add a
  `squadSource` to the competition. `npm run scaffold` then reads each team's current
  squad and writes `visible: true` player skeletons (name, DOB, shirt#, position,
  nationality, and — via Wikipedia — image/height/foot/birthplace); `enrich` tops up the
  rest. Two sources:
  - `squadSource: wikipedia` — reads the club's `{{fs player}}` current-squad template
    from Wikipedia (accurate, editor-maintained), so each team needs a `wikipedia:`
    article title; each linked player is resolved to a Wikidata QID for their data.
  - `squadSource: wikidata` — the looser Wikidata `member of sports team` query (drags in
    former players whose membership was never end-dated; kept for leagues without good
    Wikipedia squad templates).

  Scaffold matches by DOB + last name (like `enrich`), so re-runs update in place and
  never duplicate curated players. After a **non-empty** fetch it prunes: scaffold-managed
  players (`wd-` ids, `auto_update`) no longer in the squad are hidden (`visible: false`,
  never deleted); curated players (non-`wd-` ids) are never touched.

## Build pipeline details

`scripts/content.js` is the shared core — `loadContentData()` reads all Markdown, applies
`normalizeCompetition/Team/Player`, filters by `visible`, sorts, and returns the nested
structure. Player sort is by position (`mapPosition` assigns a `sort` rank and emoji),
then name; competitions/teams sort by `sortOrder` then name (German collation).
`mapPosition` and `translateNationality` map English API terms to German labels — extend
these maps when new positions/nationalities appear rather than translating inline.

`scripts/build-site.js` produces this URL structure under `dist/`:
- `index.html` — competition list
- `<code>/index.html` — team list (competition code lowercased)
- `<code>/<teamId>/index.html` — player cards
- `data/*.json` — JSON mirror of the content (also written to top-level `data/`)
- `assets/style.css`, `assets/app.js`, `images/…`, and a `.nojekyll` marker

Templates pass a `rootPath` (`./`, `../`, `../../`) into the `head`/`header` partials so
relative asset links resolve at each depth — preserve this when adding pages or nesting
levels.

`writeMarkdownFile` sorts keys, strips `undefined`, and skips writing when content is
unchanged (keeps diffs clean and idempotent). Reuse it for any Markdown output.

## External API notes

- **football-data.org** free tier ≈ 10 requests/minute. `build.js` throttles with
  `DELAY_BETWEEN_TEAM_REQUESTS_MS` (6.5s) and `DELAY_BETWEEN_COMPETITIONS_MS` (7s) and
  handles HTTP 429. Requires `FOOTBALL_DATA_API_KEY` (repo secret in CI). Do not remove
  or shorten the delays casually — sync will get rate-limited.
- **Wikidata**: queries via `scripts/wikidata.js`; always sends a descriptive
  `User-Agent`. `enrich.js` matches API players to Wikidata by date-of-birth + last-name,
  with per-player fallback queries. It also fills a team's `crest` from Wikidata
  (`getTeamCrest`: P154 logo image, falling back to P41 flag image for national teams) —
  but only for `auto_update` teams that have no crest yet, so a clean football-data.org
  crest is never replaced. Many club logos are copyrighted and absent from Wikidata, so
  coverage is partial (best for national teams). `sanitizeSparqlString()` guards SPARQL
  string interpolation — always use it when injecting user/data strings into a query.

## Conventions

- Node.js CommonJS (`require`), no build step for the scripts themselves, no TypeScript.
- Keep the dependency footprint tiny (only `gray-matter` + `handlebars`).
- User-facing text is Swiss German (de-CH), including date formatting (`formatDate`
  helper) and units ("Grösse", "cm", "Jahre").
- Emojis are used deliberately (flags, position icons, console logs) — this is a kids'
  app; keep the playful tone.
- Prefer the shared helpers in `content.js`/`wikidata.js` over duplicating logic.

## CI / deployment

- **Build and Deploy** (`build-deploy.yml`): on push to `main` or manual dispatch; runs
  `npm ci` + `npm run build`, uploads `dist/` to GitHub Pages. Offline, no secrets.
- **Update Content** (`update-content.yml`): Mondays 06:00 UTC or manual (with a
  `competition` choice → `COMPETITION_FILTER`); runs `npm run sync:content` with the
  `FOOTBALL_DATA_API_KEY` secret, then commits any changed files under `content/`,
  `package.json`, `package-lock.json` as "Update markdown content". Content updates and
  deploys are decoupled: syncing commits Markdown to `main`, which then triggers a deploy.

When editing content programmatically, mirror this flow: change Markdown under
`content/`, let (or run) the build regenerate `dist/` — never edit `dist/` or `data/`
directly.
