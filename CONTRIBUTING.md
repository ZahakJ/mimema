# Contributing

Patches welcome. This is a side project, not Kubernetes — there is no CLA, no
RFC process, and no committee. There is one bar, and it is green.

## Getting set up

Requires Node 26+ (the server is run straight from TypeScript via Node's
type-stripping — there is **no server build step**).

```sh
npm install
npm run templates      # pull the imgflip classic pack into data/ (idempotent)
npm run seed           # import seed-assets/ as the first wall items (re-runnable)
cp .env.example .env   # set INVITE_KEY to anything for local work
```

Then run the dev pair in two terminals:

```sh
npm run dev:server     # Hono API on :5900
npm run dev            # Vite on :5901, proxies /api, /m, /t → :5900
```

Open <http://localhost:5901>.

## The done bar

Before you open a PR:

```sh
npm run typecheck && npm test && npm run build && npm run smoke
```

All four green. `smoke` drives a real browser (Playwright) against a built
preview server and writes `screenshots/`; if it fails on a console error, that
is the test working as intended.

## Things worth knowing

- **`shared/schema.ts` is the single source of truth.** Zones, layers, and the
  wire DTOs are zod schemas there. Zones and layers use one fractional
  coordinate system (`x/y/w/h ∈ 0..1` of the document) shared by templates, the
  editor, and the zone editor. If you change a shape, change it there first.
- **`renderMeme` is the only render path.** Preview and PNG export both go
  through it so they can never drift apart. Export re-renders at native
  template resolution. Do not add a second painter.
- **Sniffed MIME is truth.** `server/sniff.ts` decides type and extension from
  magic bytes; client-declared content types are ignored. SVG stays
  unsupported on purpose.
- **The server has no build step.** Don't add one, and don't import anything
  that needs a transform Node can't strip.
- Media URLs are immutable and items dedup by sha256 — a new upload gets a new
  slug, identical bytes return the existing one.

## Style

Match the surrounding code. Small, focused PRs. Comments explain *why*, not
*what*. If you touch UI, include a before/after screenshot — and keep the
palette: crimson accent on obsidian, flame→gold gradients. No purple, no pink,
no acid green. This rule is load-bearing.
