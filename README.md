<p align="center"><img src="docs/media/banner.webp" width="820" alt="The wall: a grid of published memes, each with a title, tags and reaction counts"></p>

# mimema

[![ci](https://github.com/ZahakJ/mimema/actions/workflows/ci.yml/badge.svg)](https://github.com/ZahakJ/mimema/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-8b0000.svg)](LICENSE)

A self-hosted meme editor and media host: make a meme from a template,
download the PNG, or publish it to a permanent, hotlinkable URL that unfurls
in chat apps. It is meant for a group of friends, a team or a chat server
that wants its own meme wall: one Node process, one SQLite file, one shared
key for writing. Live at <https://meme.avicenna.space>.

## Features

- **About 260 templates with hand-placed captions.** The importer pulls the
  imgflip and memegen.link packs; 115 popular templates carry a curated
  layout, so Drake's captions land in the right-hand column and Distracted
  Boyfriend's on the three people, each with a placeholder saying what goes
  there.
- **A full editor.** Move, resize and rotate text; five bundled meme fonts;
  outline and shadow; stickers from a file or pasted from the clipboard; a
  deep-fry filter; 60 steps of undo. The draft survives a reload.
- **Exports at native resolution.** The download is re-rendered at the
  template's own size, so it does not depend on how large the window was.
- **Permanent links.** A published file lives at `/m/<slug>.<ext>` and never
  changes; `/m/<slug>` is a share page with OpenGraph and Twitter card tags,
  so a pasted link previews as the image.
- **The wall.** Everything published, searchable by title, filterable by tag
  or template, sortable by reactions, with three emoji reactions anyone can
  add. Plain uploads (PNG, JPEG, GIF, WebP, MP4, WebM) sit alongside memes.
- **Your own templates.** `#/add-template` takes any image and lets you draw
  up to 24 caption zones on it.
- **Works on a phone.** Below 900 px the forge becomes a canvas with bottom
  sheets, and the canvas stays visible while you type.
- **Scriptable.** A JSON API for uploads and listing, and a deep link that
  loads a template with captions so a headless browser can export the PNG.
- **Optional text-to-meme relay.** A separate daemon takes a chat transcript
  or the day's news, has a language model pick the template and write the
  captions, and publishes the result.

## Install

Node 26 or later.

```sh
git clone https://github.com/ZahakJ/mimema && cd mimema && npm install
npm run templates && npm run templates:layouts   # fetch ~260 templates into data/
cp .env.example .env                             # set INVITE_KEY and PUBLIC_ORIGIN
npm run build && npm start                       # http://127.0.0.1:8001
```

`openssl rand -base64 24` makes a suitable `INVITE_KEY`. For development, run
`npm run dev:server` (API on :5900) and `npm run dev` (the client on
<http://localhost:5901>, with hot reload).

## Use

| | |
| --- | --- |
| `#/` | The forge: pick a template, edit the captions, add stickers or paste an image, deep-fry, then download or publish. |
| `#/wall` | Everything published: search, filter by tag or template, sort by reactions, react, upload. |
| `#/add-template` | Draw caption zones on any image to make a template. |
| `#/paper` | [The white paper](WHITEPAPER.md). |

Viewing and making memes need no key. Publishing, uploading, adding templates
and deleting need `INVITE_KEY`, entered once in the app or sent as the
`x-meme-key` header:

```sh
curl -H "x-meme-key: $INVITE_KEY" \
  -F file=@meme.png -F kind=meme -F title="Friday deploys" -F tags=ops,code \
  http://127.0.0.1:8001/api/items
```

Uploads are accepted up to 12 MB for images and 40 MB for video.

<p align="center">
  <img src="docs/media/forge.webp" width="400" alt="The forge: template rail on the left, Distracted Boyfriend with three captions on the canvas, text controls on the right">
  <img src="docs/media/templates.webp" width="400" alt="The forge with Gru's Plan: four captions placed on the four easels by the template's curated layout">
</p>
<p align="center">
  <img src="docs/media/share-page.webp" width="400" alt="The share page of a published meme, with its title and a link back to the wall">
  <img src="docs/media/paper.webp" width="400" alt="The white paper, On the Quiddity of the Meme, rendered in the app">
</p>

## How it works

The client is a React app; the server is Hono, run by Node directly from
TypeScript with no build step, keeping metadata in SQLite and files on disk
under `data/`. A single canvas function, `renderMeme`, draws both the preview
and the export. All geometry is stored as fractions of the image (a zone is
`x, y, w, h` in 0..1, font size a fraction of the image height), so one
document renders identically at any scale, and export simply draws again at
native size. Text wraps greedily, then shrinks 8% at a time until it fits its
box. Uploads are typed by their first bytes rather than the declared content
type, deduplicated by SHA-256, and given an adjective-noun slug such as
`mysterious-gazebo`. Writes need the key in a custom header; since the server
sends no CORS headers, a cross-origin request carrying it fails its preflight.
The relay never draws memes itself: it opens the forge's deep link in headless
Chromium and calls the same export the download button uses.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): layout, data model, rendering, security, tests
- [HTTP API](docs/API.md): items, templates, media URLs, headless export
- [Templates](docs/TEMPLATES.md): import, curated layouts, duplicates, meanings
- [Relay](docs/RELAY.md): the text-to-meme daemon
- [Deployment](docs/DEPLOYMENT.md): configuration, proxies, systemd, backups
- [Contributing](CONTRIBUTING.md) and [security](SECURITY.md)

## License

[MIT](LICENSE). Template images downloaded by `npm run templates` are not
covered and belong to their owners. Fonts ship under their own open licenses.
