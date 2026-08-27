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
- `npm run templates` — idempotently pull the ~290-template pack (imgflip + memegen.link, name-collision deduped, attribution recorded) into `data/`
- `npm run seed` — import `seed-assets/` as the first wall items (sha-dedup, re-runnable)
- `npm start` — prod server (reads `.env`, defaults PORT 8001)

## Architecture

- `client/` React app: `editor/` (the forge), `gallery/` (the wall),
  `zone-editor/` (make templates from any image), `paper/` (the whitepaper —
  WHITEPAPER.md at repo root is canonical, imported `?raw` + rendered with
  marked, raw-HTML tokenizers disabled), hash routes in `router.ts`
  (`#/`, `#/wall`, `#/add-template`, `#/edit/<templateId>`, `#/paper`).
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
- localStorage keys are namespaced `mimema:v1:*`.
- Set `document.body.dataset.appReady = '1'` after first render (smoke waits on it).

## Deploy

systemd user unit lives in `deploy/meme.service`, symlinked from
`~/.config/systemd/user/` + `avicenna-suite.target.wants/` (leyline pattern).
`.env` holds `INVITE_KEY` (empty key = publishing disabled). After changing
client code: `npm run build && systemctl --user restart meme.service`.

Done bar: `npm run typecheck && npm test && npm run build && npm run smoke`
all green, plus `curl http://127.0.0.1:8001/healthz` **and**
`curl http://[::1]:8001/healthz` after deploy.
