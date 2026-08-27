# mimema

**μίμημα** — *that which is imitated*. A meme forge and self-hosted media host,
dark and epic, running at [meme.avicenna.space](https://meme.avicenna.space).

Dawkins cut "meme" out of the Greek *mimeme* so it would sound like "gene." This
is the uncut version: forge a meme in the browser, download the PNG, or publish
it to a permanent, hotlinkable URL that unfurls properly in every chat app.

![The Forge — template picker, canvas, inspector](docs/screenshots/forge.png)
![The Wall — masonry gallery with search and filter](docs/screenshots/wall.png)

## Features

- **The Forge** — ~290 classic templates (or any image you upload), draggable
  text zones, meme-grade faces (Anton, Bangers, Oswald) with proper outlines and
  drop shadows, per-zone font/size/color/rotation, stickers pasted straight from
  the clipboard, a layer stack, undo/redo, drafts that survive a refresh,
  copy-PNG-to-clipboard, and a deep-fry toggle with live preview.
- **The Wall** — publish with the invite key and every artifact gets a fun
  permanent slug (`unhinged-capybara`), a direct hotlink, an OpenGraph share page
  that unfurls in Discord/Telegram/Slack, tags, 🔥 💀 🗿 reactions, and a spot on
  the masonry wall with search, tag/template filters, sorting, shuffle, and a
  lightbox with inline editing for key-holders.
- **The Zone Editor** — upload any screenshot, draw its text zones (live
  placeholder preview, eight resize handles), name it, and it joins the template
  pack for everyone. The picker keeps favorites and your recently used.
- **White Paper** — the in-app whitepaper, *On the Quiddity of the Meme*
  ([WHITEPAPER.md](WHITEPAPER.md)), rendered at `#/paper`.
- **Media host** — PNG, JPEG, GIF, WebP, MP4, and WebM served with byte-range
  support and one-year immutable caching. Identical bytes dedup to one slug.
- **One render path** — what you see in the preview is exactly what exports,
  because they are literally the same function.
- **Small and boring underneath** — no ORM, no image-processing native modules,
  no bundler for the server. `node:sqlite` for metadata, plain files for blobs.

## Quickstart

Requires **Node 26+** (the server runs TypeScript directly via type-stripping).

```sh
git clone <your-fork> mimema && cd mimema
npm install
npm run templates      # fetch the classic template pack into data/
npm run seed           # optional: import seed-assets/ as the first wall items
cp .env.example .env   # set INVITE_KEY
npm start              # http://127.0.0.1:8001
```

`npm start` serves the API and, if you've run `npm run build`, the client bundle
from `dist/`. Without a build it will tell you so and stay up for API work.

> **On the template pack.** `npm run templates` fetches the classic packs from
> imgflip and memegen.link (~290 templates, attribution recorded and linked in
> the UI) at install time into the gitignored `data/` directory. Those images are
> **not redistributed in this repository** and remain the property of their
> respective owners. The script is idempotent — re-run it any time;
> already-present templates are skipped.

## Configuration

All configuration is environment variables, read from `.env` (see
`.env.example`). Nothing is required except a key if you want writes.

| Variable | Default | What it does |
| --- | --- | --- |
| `INVITE_KEY` | *(empty)* | Shared passphrase for publishing, uploading, adding templates, and deleting. **Empty means all writes are disabled** and the server says so on boot. |
| `HOST` | `127.0.0.1` | Bind address. At the default it also binds `::1`, because tunnels resolving `localhost` to IPv6 will otherwise 502. |
| `PORT` | `8001` | Listen port. |
| `PUBLIC_ORIGIN` | `http://localhost:<PORT>` | Origin used to build absolute URLs in OpenGraph tags. Set this to your public origin or share links will point at localhost. |
| `DATA_DIR` | `./data` | Where the SQLite database, media blobs, and template images live. |
| `ALLOW_VIDEO` | `1` | Set to `0` to refuse MP4/WebM uploads. |
| `RATE_LIMIT` | `1` | Set to `0` to disable the built-in per-IP rate limiting. |
| `RATE_LIMIT_VERIFY` / `_WRITE` / `_READ` / `_REACT` / `_WINDOW_MS` | `10` / `30` / `120` / `60` / `60000` | Requests allowed per window for key verification, writes, reads, and reactions. |

Upload caps are 12 MB for images and 40 MB for video. Use a long `INVITE_KEY`
(`openssl rand -base64 24`) — the server warns on boot below 12 characters.

## Development

Two terminals:

```sh
npm run dev:server     # Hono API on :5900
npm run dev            # Vite on :5901, proxying /api, /m, /t → :5900
```

The done bar, which every change must clear:

```sh
npm run typecheck && npm test && npm run build && npm run smoke
```

`smoke` drives a real browser with Playwright against a preview build, fails on
any console error, and drops fresh screenshots in `screenshots/`.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## Architecture

Single npm package, three source roots, no monorepo tooling.

```
client/    Vite 7 + React 19 — editor/ (the forge), gallery/ (the wall),
           zone-editor/ (make templates), hash routes in router.ts
server/    Hono 4 on Node, run directly from TypeScript (no build step).
           app.ts is listen-free so tests drive app.request() in-process.
shared/    schema.ts — zod schemas for zones, layers, and wire DTOs.
```

Load-bearing decisions:

- **`renderMeme` is the only render path.** The canvas preview and the PNG
  export call the same function; export simply re-renders at the template's
  native resolution. They cannot diverge because there is nothing to diverge
  from.
- **One fractional coordinate system.** Zones and layers are `x/y/w/h ∈ 0..1` of
  the document, shared by template presets, editor math, and the zone editor. A
  meme is scale-free; so is its geometry.
- **Sniffed MIME is truth.** `server/sniff.ts` decides type and extension from
  magic bytes. Client-declared content types are ignored entirely. SVG is
  deliberately unsupported — scriptable XML on a hotlinkable origin is an XSS
  vector, not a feature.
- **Media URLs are immutable.** `/m/<slug>.<ext>` is served with a one-year
  immutable cache; a new upload gets a new slug, never a new body at an old URL.
  `/m/<slug>` (no extension) is the share page carrying the OpenGraph tags.
- **Items dedup by sha256.** Re-uploading identical bytes returns the existing
  slug instead of a second copy.
- **Auth is one shared key**, sent as `x-meme-key` and compared as a
  constant-time hash. Reads are public; every write is gated.

## Deployment

The server is a single long-lived Node process behind whatever you already use
for TLS — nginx, Caddy, Traefik, a Cloudflare tunnel, a Tailscale node. It binds
loopback by default and expects something in front of it.

A systemd **user** unit is included at [`deploy/meme.service`](deploy/meme.service);
symlink it into `~/.config/systemd/user/` and enable it:

```sh
ln -s "$PWD/deploy/meme.service" ~/.config/systemd/user/meme.service
systemctl --user daemon-reload
systemctl --user enable --now meme.service
curl http://127.0.0.1:8001/healthz     # → ok
```

After changing client code: `npm run build && systemctl --user restart meme.service`.

The reference deployment puts a Cloudflare tunnel in front of port 8001, but
nothing in the code knows or cares — any reverse proxy works. It also runs
perfectly well with no public exposure at all: point `PUBLIC_ORIGIN` at a LAN
address and you have a meme forge for one household, one office, or one very
committed individual.

## Whitepaper

There is a whitepaper: [WHITEPAPER.md](WHITEPAPER.md), also served in-app under
**White Paper**. It exists, you should read it, and it is rigorous.

![White Paper — On the Quiddity of the Meme](docs/screenshots/paper.png)

## License

[MIT](LICENSE) © 2026 Avicenna.

Template images fetched by `npm run templates` are not covered by this license
and remain the property of their respective owners. Anton is licensed under the
SIL Open Font License; Inter and JetBrains Mono likewise ship under their own
open licenses.
