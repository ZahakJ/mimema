# Architecture

Mimema is one npm package with three parts that share a schema:

```
client/   React 19 single-page app, built by Vite 7 into dist/
server/   Hono 4 HTTP server, run by Node 26 directly (TypeScript type-stripping, no build)
shared/   zod schemas and wire types imported by both
```

The server stores metadata in SQLite (`node:sqlite`) and files on disk, both
under `DATA_DIR` (default `./data`). It serves the API, the media, and the
built client from one process. Everything that creates a meme from text runs
in the optional `relay/` daemon ([RELAY.md](RELAY.md)); nothing in `client/`,
`server/`, `shared/` or `scripts/` imports from it.

```
browser ──► server (Hono) ──► SQLite  data/mimema.sqlite
   │            │         └─► blobs   data/media/<slug>.<ext>
   │            │                     data/templates/<id>.<ext>
   │            └─► dist/  (client bundle)
   └─ renderMeme (canvas) ─► PNG ─► POST /api/items
```

## Repository

| Path | Contents |
| --- | --- |
| `server/app.ts` | `createApp(config, db)`: middleware, routes, static client. Does not listen, so tests call `app.request()`. |
| `server/index.ts` | Opens the database, binds `HOST:PORT`; with the default host it also binds `::1`. |
| `server/store.ts` | Every SQL statement and blob write. Routes stay thin. |
| `server/db.ts` | `openDb()` and the migration ladder. |
| `server/sniff.ts`, `server/imageSize.ts` | Magic-byte type detection and header-only dimension probing. |
| `server/routes/` | `items.ts`, `templates.ts`, `media.ts`. |
| `server/share.ts` | The server-rendered OpenGraph page at `/m/<slug>`. |
| `shared/schema.ts` | Zones, layers, the editor document, tags, reactions, DTOs. |
| `client/editor/` | The forge: canvas stage, inspector, template picker, publish dialog, `renderMeme`. |
| `client/gallery/` | The wall: masonry grid, filters, lightbox, reactions. |
| `client/zone-editor/` | Draw caption zones on any image to make a template. |
| `client/paper/` | Renders `WHITEPAPER.md` (imported `?raw`, through marked with raw HTML disabled). |
| `scripts/` | Template import, dedupe, curated layouts, meanings, seeding ([TEMPLATES.md](TEMPLATES.md)). |
| `relay/` | Optional loopback daemon ([RELAY.md](RELAY.md)). |
| `tools/screenshot.mjs` | The smoke test. |
| `tools/render-proof.mjs` | Renders one template through the real forge to a PNG. |

## Data model

Three migrations, applied by `openDb()` in order; `PRAGMA user_version`
records how many have run. A schema change appends a rung to `MIGRATIONS` in
`server/db.ts`; shipped rungs are never edited or renumbered.

```sql
templates (
  id          TEXT PRIMARY KEY,      -- slugified name, also the file name
  name        TEXT NOT NULL,
  source      TEXT NOT NULL,         -- 'imgflip' | 'memegen' | 'custom' | 'seed'
  ext         TEXT NOT NULL,
  width, height INTEGER NOT NULL,    -- native size; export renders at this size
  zones_json  TEXT NOT NULL,         -- Zone[] (shared/schema.ts)
  created_at  INTEGER NOT NULL,
  source_url  TEXT,                  -- upstream page, for attribution
  source_ref  TEXT                   -- upstream id
)

items (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,  -- adjective-noun
  kind        TEXT NOT NULL,         -- 'meme' | 'upload'
  title       TEXT NOT NULL DEFAULT '',
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  mime, ext   TEXT NOT NULL,         -- from the sniffer, never the client
  bytes       INTEGER NOT NULL,
  width, height INTEGER,             -- NULL for video
  sha256      TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
)

item_tags      (item_id → items ON DELETE CASCADE, tag,   PRIMARY KEY (item_id, tag))
item_reactions (item_id → items ON DELETE CASCADE, emoji, count, PRIMARY KEY (item_id, emoji))
```

The database runs in WAL mode with `foreign_keys = ON`. Migration 3 widens the
`source` CHECK, which SQLite can only do by rebuilding the table; it turns
foreign keys off for the swap, because with them on, `DROP TABLE templates`
would null every `items.template_id`.

**Slugs.** `uniqueSlug()` draws an adjective and a noun from
`shared/slugWords.ts`, tries eight times for an unused pair, then appends a
two-character base-36 suffix. A template id is `slugifyName(name)` (ASCII,
dashes, at most 60 characters), with `-2`, `-3`, … on collision.

**Dedup.** `createItem()` hashes the bytes first. If the sha256 exists, nothing
is written: the existing row is returned with `deduped: true` (HTTP 200
instead of 201) and any new tags are merged into it. Blob writes precede the
insert; a failed insert removes the blob.

**Tags** are slugified to `[a-z0-9-]`, at most 24 characters, at most 8 per
item; extras are dropped, not rejected. **Reactions** are a fixed vocabulary
of three emoji, so counts stay a small bounded set.

**Listing.** `new` and `old` are keyset-paged on `(created_at, id)`; the
cursor is `<created_at>.<id>`. `top` orders by the sum of reaction counts and
returns one page only, since a mutable count has no stable cursor. Tags and
reactions for a page are loaded with one grouped query each.

## Rendering

`client/editor/renderMeme.ts` is the only render path. The on-screen preview
and the exported PNG both call it; export draws again at the template's
native width and height (`exportPng.ts`), so the file never depends on the
size of the window.

All geometry is fractional. A zone or layer is `x, y, w, h` in 0..1 of the
image, plus `angle` in degrees about its centre. Font size (`fontFrac`) is a
fraction of the image height, stroke width (`strokeFrac`) a fraction of the
font size, and shadow offsets and blur fractions of the image height. One
document therefore renders identically at any scale, and templates, editor
layers and the zone editor share the same coordinates.

Text layout (`textLayout.ts`) is a pure function: greedy word wrap, then
shrink by 8% per step until the block fits the box or reaches 2% of the image
height. Each text layer draws an optional shadow pass, then every line's
stroke, then every line's fill, so a thick outline never covers the previous
line. The deep fryer (`deepFry.ts`) saturates and sharpens contrast, adds
deterministic xorshift noise, and re-encodes twice as JPEG at quality 0.25;
the preview fries a copy at most 700 px wide, the export fries full size.

Fonts: Anton, Bangers, Oswald, Inter and JetBrains Mono, bundled with the
client. Before the first paint `EditorView` awaits `document.fonts.load()`
for every face the document uses, so a fallback face is never baked into a
preview.

## Editor state

The document (`memeDocSchema`) is a template id, native size, an ordered list
of text and sticker layers, and a deep-fry flag. It lives in a zustand store.
Undo keeps 60 snapshots in memory; a drag or resize snapshots once at the start
of the gesture. The document is saved to `localStorage` under
`mimema:v1:editor` (debounced 400 ms, validated by zod on restore, skipped
above 2 MB because pasted stickers are data URLs). Other per-browser state:
`mimema:v1:auth` (the key), `mimema:v1:favorites`,
`mimema:v1:recent-templates`, `mimema:v1:reacted`.

Routes are hash routes (`client/router.ts`): `#/`, `#/wall`,
`#/add-template`, `#/paper`, and `#/edit/<templateId>?c=…&c=…&title=…`, which
loads a template with one caption per zone and takes precedence over a saved
draft. See [API.md](API.md#automation) for driving it headlessly.

## Phone layout

Every responsive rule is in `client/styles/mobile.css`, in two blocks:
`max-width: 900px` for layout and `pointer: coarse` for touch.
`PHONE_QUERY` in `client/usePhone.ts` is the same 900 px query and is the only
layout branch in JavaScript. Below it, the forge shows the canvas and a tray
(templates, edit, ship); the template picker and inspector open in bottom
sheets. The edit sheet is non-modal and capped at 62dvh, and the stage shrinks
to the remaining 38dvh, so the canvas stays visible and draggable while
typing. Inputs are 16 px under `pointer: coarse` so iOS does not zoom on
focus; `viewport-fit=cover` and the `--safe-*` tokens keep edge-pinned
controls clear of the notch.

## Security

- **Types come from bytes.** `sniff()` recognises PNG, JPEG, GIF, WebP, WebM,
  and MP4 by an allowlist of ISO-BMFF major brands; AVIF, HEIC and MOV are
  rejected. The declared content type is ignored. SVG is not accepted.
- **Limits.** Images 12 MB, video 40 MB, either dimension at most 20,000 px
  (read from the header, before any decode).
- **Writes** (upload, edit, delete, templates) require the `x-meme-key`
  header. Both sides are hashed with SHA-256 before `timingSafeEqual`, so
  neither the key nor its length leaks through timing. An empty `INVITE_KEY`
  disables writes.
- **CSRF.** There is no CORS middleware. `x-meme-key` is not a
  CORS-safelisted header, so a cross-origin request carrying it needs a
  preflight, which the server does not answer; the browser blocks it.
  Reactions are public by design and have their own rate limit.
- **Headers.** `nosniff` on every response, HSTS, a same-origin opener policy,
  and on HTML a CSP of `default-src 'self'` with `img-src`/`media-src` adding
  `data:`/`blob:`, `font-src 'self' data:` (Vite inlines small font subsets),
  `frame-ancestors 'none'`, and no inline script.
- **Rate limits.** An in-memory sliding window per client IP, in four
  buckets: key verification, writes, reads, reactions
  ([DEPLOYMENT.md](DEPLOYMENT.md#configuration)). The IP is taken from
  `CF-Connecting-IP` when present, which is safe only because the server
  binds loopback and is reached through a tunnel or proxy.

## Tests

- `npm test`: Vitest over the server (`app.request()` against a database in
  a temporary directory), schema, store, migrations, text layout, router, editor store,
  layouts, meanings, duplicates, and the relay with injected model and
  browser.
- `npm run smoke` (`tools/screenshot.mjs`): builds, starts the server on
  :6901 with a temporary data directory, seeds a template and an item through
  the API, and loads every route in Chromium at 1440×900 and as a 390×844
  touch phone. On the phone it drives the tab bar, template sheet and tray. It
  fails on any console error or any control off-screen, and writes
  `screenshots/`.
- CI runs typecheck, tests, build and smoke on every push and pull request.
