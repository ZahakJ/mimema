# Mimema

Meme generator + media host at **meme.avicenna.space** — μίμημα, the Greek word
Dawkins coined "meme" from: *that which is imitated*. Anyone can forge and
download memes; publishing to the wall, uploading media, and adding templates
need the shared `INVITE_KEY`. Single npm package (leyline shape): Vite 7 +
React 19 client, Hono 4 server run directly by Node 26 (TS type-stripping, no
server build), `node:sqlite` metadata + blobs on disk under gitignored `data/`.

Ports: dev API **5900**, dev Vite **5901**, smoke/preview **6901**, prod
**8001** (Cloudflare tunnel `cf-meme` ingress points at 8001 — remotely
managed in the CF dashboard; keep 8001 or you must edit the dashboard).
Accent: blood crimson `--accent-rgb: 237, 49, 63` with a flame→gold gradient
sweep (`--grad`) on obsidian surfaces — "dark and epic". The user explicitly
vetoed purple, pink, AND acid green; never reintroduce any of them.
Oversized type scale (md=17px). Body font Inter, mono
JetBrains Mono, meme voice **Anton** (open Impact stand-in).

## Commands

- `npm run dev:server` + `npm run dev` — dev pair (vite proxies /api,/m,/t → :5900)
- `npm run typecheck` / `npm test` / `npm run build` / `npm run smoke` — the done bar
  (smoke loads every route twice: desktop 1440x900 and a touch phone 390x844,
  drives the phone-only tray → sheet → ship path, and fails if a control lands
  off-screen)
- `npm run templates` — idempotently pull the ~270-template pack (imgflip + memegen.link, deduped, attribution recorded) into `data/`
- `npm run templates:dedupe [-- --dry-run]` — prune duplicates an older pull let in (destructive, so it's deliberately not part of `npm run templates`)
- `npm run seed` — import `seed-assets/` as the first wall items (sha-dedup, re-runnable)
- `npm start` — prod server (reads `.env`, defaults PORT 8001)

## Architecture

- `client/` React app: `editor/` (the forge), `gallery/` (the wall),
  `zone-editor/` (make templates from any image), `paper/` (the whitepaper —
  WHITEPAPER.md at repo root is canonical, imported `?raw` + rendered with
  marked, raw-HTML tokenizers disabled), hash routes in `router.ts`
  (`#/`, `#/wall`, `#/add-template`, `#/edit/<templateId>`, `#/paper`).
  `styles/mobile.css` is the phone layer, `usePhone.ts` its one JS branch,
  `components/Sheet.tsx` the bottom sheet the rails ride in.
- `server/` Hono: `app.ts` is listen-free (`createApp(config, db)`) so tests
  drive `app.request()`; `index.ts` binds 127.0.0.1 **and ::1** (cloudflared
  resolves localhost to ::1 first — drop that twin bind and the tunnel 502s).
- `shared/schema.ts` is the single source of truth (zod) for zones, layers,
  DTOs. Zones/layers use one fractional coordinate system (x/y/w/h ∈ 0..1 of
  the doc) shared by templates, editor math, and the zone editor.

### Invariants (hard-won)

- **`renderMeme` is the only render path** — preview and PNG export both go
  through it, so they can never diverge. Export re-renders at native template
  resolution.
- **Sniffed MIME is truth**: `server/sniff.ts` magic bytes decide type/ext;
  client-declared types are ignored. SVG is deliberately unsupported (XSS on a
  hotlinkable host). ftyp files are whitelisted by major brand — AVIF/HEIC/MOV
  are rejected, not stored as mp4. `X-Content-Type-Options: nosniff` everywhere.
- **No CORS middleware, on purpose**: the non-safelisted `x-meme-key` header
  forces a failing preflight cross-origin — that IS the CSRF defense. Adding
  `cors()` would silently remove it (comment in `server/auth.ts`).
- Rate limiting is in-memory per-IP (`server/rateLimit.ts`), keyed by
  `CF-Connecting-IP` (safe only because the server binds loopback). Knobs:
  `RATE_LIMIT=0` disables; `RATE_LIMIT_VERIFY/_WRITE/_READ/_REACT/_WINDOW_MS`.
- DB schema changes append a rung to the `MIGRATIONS` array in `server/db.ts`
  (currently v3) — never renumber. Widening a CHECK needs the full
  foreign_keys=OFF table-rebuild dance (see the v3 rung).
- CSP includes `font-src 'self' data:` — vite inlines small font subsets as
  data: URIs and the smoke test fails without it.
- Font preload before first canvas paint is doc-driven: `EditorView` loads
  every face the doc uses (∪ Anton) via `fontLoadSpec()` from `renderMeme.ts`,
  else the fallback font bakes into the preview. Meme faces: Anton, Bangers,
  Oswald (`MEME_FONTS` in `shared/schema.ts`).
- Editor drafts persist to `mimema:v1:editor` (debounced, zod-validated on
  restore, skipped past ~2MB — sticker data-URLs); undo history is memory-only.
- Derived accent vars live on `body`, NOT `:root` (family pitfall — the
  `[data-app]` override must compute first).
- Media URLs are immutable (`/m/<slug>.<ext>`, 1y immutable cache); a new
  upload gets a new slug. Share page `/m/<slug>` (no ext) carries the OG tags.
- items dedup by sha256 — re-uploading identical bytes returns the existing slug.
- Template dedup is **name-based and therefore blind**: the two packs ship the
  same picture under different titles ("Two Buttons"/"Daily Struggle",
  "Bell Curve"/"Midwit"). `scripts/duplicates.ts` is the hand-curated,
  eye-confirmed list of those, and the single source of truth for both
  `fetch-templates.ts` (never import them) and `dedupe-templates.ts` (prune
  what an older run did). A perceptual hash can only *propose* pairs — it
  calls every four-panel meme a duplicate of every other, and would happily
  merge the four Socially * Penguins, which are four different memes.
- Deleting a template must repoint `items.template_id` first: the FK is
  `ON DELETE SET NULL`, so a plain delete silently strips the "remix this
  template" link off every meme forged from it.
- localStorage keys are namespaced `mimema:v1:*`.
- **Every responsive rule lives in `client/styles/mobile.css`** — two blocks,
  deliberately separate: `max-width: 900px` (LAYOUT) and `pointer: coarse`
  (TOUCH). That 900px is mirrored by `PHONE_QUERY` in `client/usePhone.ts`;
  change one and you must change the other or the CSS and the JSX disagree
  about which layout is on screen.
- Below 900px the forge has no room for three rails: `EditorView` renders the
  canvas + `.mm-tray` (templates / edit / ship) and moves `TemplatePicker` and
  `Inspector` into `<Sheet>`s. The nav is rendered twice — titlebar and bottom
  tab bar — and CSS displays exactly one, so only one is in the a11y tree.
- The edit sheet is **non-modal on purpose** (`modal={false}`): its scrim is
  `pointer-events: none`, and `.mm-editor--lifted` shrinks the stage to the gap
  the sheet leaves, so the canvas above stays visible *and* draggable while you
  type. Change the sheet's 62dvh cap and you must change that `38dvh` too.
- `viewport-fit=cover` in index.html is what makes the `--safe-*` tokens
  non-zero; anything pinned to a screen edge pads with them or lands under the
  notch. `interactive-widget=resizes-content` keeps sheets above the keyboard.
- Inputs are forced to 16px under `pointer: coarse` — anything smaller and iOS
  zooms the whole page the moment a field takes focus.
- Set `document.body.dataset.appReady = '1'` after first render (smoke waits on it).

## Deploy

systemd user unit lives in `deploy/meme.service`, symlinked from
`~/.config/systemd/user/` + `avicenna-suite.target.wants/` (leyline pattern).
`.env` holds `INVITE_KEY` (empty key = publishing disabled). After changing
client code: `npm run build && systemctl --user restart meme.service`.

Done bar: `npm run typecheck && npm test && npm run build && npm run smoke`
all green, plus `curl http://127.0.0.1:8001/healthz` **and**
`curl http://[::1]:8001/healthz` after deploy.
