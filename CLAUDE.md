# Mimema

Meme generator + media host at **meme.avicenna.space** — μίμημα, the Greek word
Dawkins coined "meme" from: *that which is imitated*. Anyone can forge and
download memes; publishing to the wall, uploading media, and adding templates
need the shared `INVITE_KEY`. Single npm package (leyline shape): Vite 7 +
React 19 client, Hono 4 server run directly by Node 26 (TS type-stripping, no
server build), `node:sqlite` metadata + blobs on disk under gitignored `data/`.

Ports: dev API **5900**, dev Vite **5901**, smoke/preview **6901**, prod
**8001** (Cloudflare tunnel `cf-meme` ingress points at 8001 — remotely
managed in the CF dashboard; keep 8001 or you must edit the dashboard), relay
daemon **8006** (loopback only; see the Relay section).
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
- `npm run templates:layouts [-- --dry-run] [-- --only <id>,…]` — write the curated zones in `scripts/layouts/<id>.json` into the DB (idempotent); proof one with `node tools/render-proof.mjs --out x.png <id> [caption …]` (`--batch ids.txt --outdir dir` for many)
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
- Template zones are curated per template in `scripts/layouts/<id>.json` and
  applied by `npm run templates:layouts`; the fetch is insert-only for zones so
  it never overwrites them. A zone's `placeholder` is the zone's *meaning*
  (never "TOP TEXT") — the forge shows it and the `/meme` skill picks captions
  by it; `scripts/layouts.ts` is the one loader and it refuses generic ones.
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
- URL state + headless hooks: `#/edit/<id>?c=..&c=..&title=..` prefills one
  caption per zone (URL beats a saved draft); `EditorView` sets
  `body[data-doc-ready=<id>]` only once the doc, captions, base image and every
  `fontLoadSpec()` face are in; `window.__mimema.exportPng()`
  (`client/automation.ts`) is the download button's exact path, never a second
  render. The smoke and `relay/forge.ts` both wait on that attribute.

## Deploy

systemd user unit lives in `deploy/meme.service`, symlinked from
`~/.config/systemd/user/` + `avicenna-suite.target.wants/` (leyline pattern).
`.env` holds `INVITE_KEY` (empty key = publishing disabled). After changing
client code: `npm run build && systemctl --user restart meme.service`.

## Relay (`relay/`, optional)

A loopback HTTP daemon (`relay/serve.ts`, `npm run relay`), and **the only
AI-touching thing in the repo** — the app itself stays AI-free, and nothing in
`client/`, `server/`, `shared/` or `scripts/` imports from `relay/`. Delete the
directory and Mimema is unchanged.

- **Mimema has no chat surface.** Binary — the user's Go Discord bot at
  `~/Documents/side/discord/go_binary` — is the only client: it gathers the
  messages, formats the transcript (`[HH:MM] name: text` lines, plus a
  `--- request ---\n<hint>` footer) and POSTs it. The relay never reads a chat.
- Wire (fixed; Binary codes against it): listens on
  `127.0.0.1:${MEME_RELAY_PORT ?? 8006}`, **and `::1`** — same twin bind as
  `server/index.ts`, so a client that resolves `localhost` to IPv6 first still
  lands. `GET /healthz` → `ok`. `POST /forge`
  `{context, source?, chatId?}` (body capped at 256 KB) →
  **200** `{slug, url, shareUrl, templateId, captions, title}` (absolute urls,
  no PNG bytes — Binary fetches the image from `url`), **400** bad JSON / empty
  context / oversized body, **429** `{error: "cooling down" | "queue full",
  retryAfterMs}`, **500** `{error: <one line>}` with the full error logged.
  Nothing else, and **no auth**: the socket is loopback-only and `INVITE_KEY`
  lives in the daemon's env, never in the request. Don't bind a routable
  address, don't add a token.
- `source` (e.g. `discord`) becomes a second tag next to `relay` on the wall
  item — lowercased and accepted only as `[a-z0-9-]{1,32}`, else dropped: it is
  caller-supplied text landing on a public page.
- `createHandler({ forge })` takes an injected forge, which is how
  `relay/serve.test.ts` covers the whole wire without a model call or a browser.
- Pipe: transcript → temp file (mkdtemp, removed in `finally`; other people's
  chat never lingers on disk) →
  `claude -p "/meme --json <file>" --output-format json --permission-prompts none
  --allowedTools "Bash(curl:*)" "Bash(python3:*)" Read` with **cwd = repo root**
  (the slash form is what loads `.claude/skills/meme/SKILL.md`; run it anywhere
  else and the skill doesn't exist) → zod-validate
  `{templateId, captions, title, alt}` → render → `POST /api/items`.
- **The relay never reimplements the render.** It drives the real page:
  `#/edit/<id>?c=…&c=…&title=…`, waits for `body[data-doc-ready="<id>"]`, calls
  `window.__mimema.exportPng()`. That URL/hook contract is the client's half —
  change it there and `relay/forge.ts` must change with it. Captions are one `c`
  per zone in zone order, spaces as `%20` (never `+`).
- `pickMeme()` takes an injectable `ClaudeRunner`, which is why forge is
  testable without spending a model call. `npm run relay:forge -- ctx.txt
  --dry-run` stops after the pick — the cheap e2e for the AI half.
- Playwright chromium is a **runtime** dependency here, not just the smoke
  test's: one lazy browser singleton per process. SIGTERM/SIGINT closes the
  listeners first, then the browser, then exits.
- `shareUrl`/`url` come back relative from the API (store.ts builds them that
  way; `PUBLIC_ORIGIN` only reaches the OG tags), so the relay absolutizes with
  `MEME_PUBLIC_ORIGIN`.
- Guards are cost guards, not an allowlist — anyone in the room may trigger it:
  `relay/gate.ts` keys a 30s cooldown by the caller's `chatId` (`"anon"` when
  Binary omits it), runs one forge at a time, five waiting max. Every admitted
  request must go through `gate.run()` or the queue slot leaks.
- `deploy/meme-relay.service` is deliberately **not** symlinked (needs a
  logged-in `claude` and an `INVITE_KEY` first) and deliberately less sandboxed
  than `meme.service`: chromium
  wants user namespaces and `claude` writes under `~/.claude`, so `ProtectHome`,
  `RestrictNamespaces` and the syscall filter are off on purpose.

Done bar: `npm run typecheck && npm test && npm run build && npm run smoke`
all green, plus `curl http://127.0.0.1:8001/healthz` **and**
`curl http://[::1]:8001/healthz` after deploy.
