# Contributing

Node 26+.

```sh
npm install
npm run templates
cp .env.example .env   # any INVITE_KEY works locally
npm run dev:server     # API on :5900
npm run dev            # http://localhost:5901
```

Before a PR:

```sh
npm run typecheck && npm test && npm run build && npm run smoke
```

- Shapes change in `shared/schema.ts` first.
- `renderMeme` is the only render path. Do not add a second one.
- Type comes from `server/sniff.ts`, never from the client. No SVG.
- The server has no build step; use only syntax Node can strip.
- UI changes come with a before/after screenshot.

How the parts fit: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
