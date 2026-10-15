# Relay

`relay/` is an optional daemon that turns text into published memes. It
accepts either a chat transcript (`POST /forge`) or a request for the day's
news (`POST /digest`), has a language model choose a template and write the
captions, renders the result through the app itself, and publishes it to the
wall. The app does not depend on it; deleting `relay/` changes nothing else.

The model runs through the `claude` command-line tool, using the two skills in
[`.claude/skills/`](../.claude/skills/): `meme` (pick a template for a
situation) and `meme-news` (find stories and pick a template for each).

## Requirements

- The `claude` CLI on `PATH`, signed in.
- Chromium for Playwright: `npx playwright install chromium`.
- A running Mimema server and its `INVITE_KEY` in the relay's environment.

```sh
npm run relay                                       # listen on :8006
npm run relay:forge -- chat.txt --dry-run           # print the pick only
npm run relay:forge -- chat.txt                     # pick, render, publish
npm run relay:forge -- --digest --count 2 --dry-run
```

`--dry-run` stops after the model call: no browser, no write, no key needed.

## Pipeline

```
context ─► claude -p "/meme --json <file>" ─► {templateId, captions, title, alt}
        ─► GET /api/templates/<id>          ─► fit captions to the zone count
        ─► headless Chromium: /#/edit/<id>?c=…  ─► window.__mimema.exportPng()
        ─► POST /api/items (tags: relay, source)  ─► {slug, url, shareUrl}
```

1. **Pick.** The transcript is written to a file in a fresh temporary
   directory, removed when the request ends. The relay runs
   `claude -p "/meme --json <file>" --output-format json --permission-prompts none --allowedTools …`
   with the repository root as working directory, which is what loads the
   skill. The picker may only run `curl`, `python3` and `Read`; it loads the
   template catalog from the live API and joins `scripts/meanings.json` onto
   it. The answer is extracted (a bare object, a fenced block, or the first
   balanced object in prose) and validated with zod.
2. **Fit.** Captions are trimmed or padded to the template's zone count.
3. **Render.** The relay does not draw memes itself. It opens the forge's deep
   link in a shared headless Chromium, waits for
   `body[data-doc-ready="<id>"]`, and calls `exportPng()`, the download
   button's own path ([API.md](API.md#automation)). Page errors are collected
   and reported if the page never becomes ready (30 s). One browser serves the
   whole process; if it disconnects, the next request launches a new one.
4. **Publish.** The PNG is posted with the key, tagged `relay` plus the
   caller's `source`. The API returns relative URLs; the relay makes them
   absolute with `MEME_PUBLIC_ORIGIN`.

A model run that exits non-zero is reported with the reason from its JSON
envelope when stderr is empty. Each run's cost and duration are logged.

## Digest

`POST /digest` runs `/meme-news --json --count N` with web search and fetch
added to the allowed tools, a 300 s timeout and `MEME_NEWS_MODEL`. Each item
names a topic (`tech`, `internet`, `sports`, `culture`, `world`, `science`),
a joke shape and a reason, then a template and captions.

`vetPicks()` refuses a pick when:

- its captions share no name, number or product with the story's title and
  blurb;
- the template has an entry in `meanings.json` whose shapes do not include the
  pick's shape;
- another pick in the digest already uses the template or the topic.

If fewer than `count` picks survive, the model is asked once more for the
missing number, given a file listing what was refused and why and what is
already taken. If nothing survives both rounds, the refused picks are
published anyway and the fact is logged. Each surviving pick then goes through
the same render and publish steps as `/forge`, one at a time, tagged `relay`,
`news`, its topic and `source`. A pick that fails to render becomes a line in
`errors`; the response is `500` only when no item was published.

Optional taste input: `exclude` (titles or URLs already posted, to skip), `interests` (a
standing description of what the audience likes, trimmed to 500 characters)
and `feedback` (up to 60 `{title, topic, up, down}` reaction counts on past
items; malformed entries are dropped). They are written to files and passed
as `--exclude` and `--taste` rather than inline.

## HTTP

Listens on `127.0.0.1` and `::1` at `MEME_RELAY_PORT` (8006). There is no
authentication; anything that can reach a loopback port can already read the
key. Bodies are capped at 256 KB. Status codes are `200`, `400`, `429` and
`500` only.

| Route | Body | Response |
| --- | --- | --- |
| `GET /healthz` | | `ok` |
| `POST /forge` | `{context, source?, chatId?}` | `{slug, url, shareUrl, templateId, captions, title}` |
| `POST /digest` | `{count?, source?, exclude?, interests?, feedback?}` | `{items: [{title, blurb, sourceUrl, topic, templateId, captions, slug, url, shareUrl}], errors: string[]}` |

- `context` is the transcript: one `[HH:MM] name: text` line per message,
  optionally followed by a `--- request ---` line and a hint.
- `source` becomes a wall tag if it matches `[a-z0-9-]{1,32}`; otherwise it is
  dropped.
- `count` is an integer from 1 to 4 (default 2); anything else is a `400`.
- Errors are `{error}`; `429` adds `retryAfterMs` and a `Retry-After` header.

**Admission.** `/forge` requests run one at a time in arrival order, with at
most five waiting; a sixth gets `429 queue full`. `MEME_RELAY_COOLDOWN_MS`
adds an optional per-`chatId` cooldown, restarted when each job finishes.
`/digest` runs one at a time with no queue: a request during a run gets
`429 busy` with a two-minute retry.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `MEME_RELAY_PORT` | `8006` | |
| `MEME_ORIGIN` | `http://127.0.0.1:8001` | Mimema API the relay reads and posts to |
| `MEME_PUBLIC_ORIGIN` | `https://meme.avicenna.space` | origin for returned URLs |
| `MEME_RELAY_MODEL` | `sonnet` | model for `/forge` |
| `MEME_NEWS_MODEL` | `opus` | model for `/digest` |
| `MEME_RELAY_COOLDOWN_MS` | `0` | per-`chatId` cooldown; `0` is off |
| `INVITE_KEY` | | required to publish |

`deploy/meme-relay.service` is a systemd user unit for it. It is sandboxed
less strictly than `meme.service`, because Chromium needs user namespaces and
the CLI writes its state under the home directory.

## Tests

`pickMeme()` takes an injected runner and `createHandler()` an injected forge
and digest, so `relay/*.test.ts` exercise parsing, vetting, admission and the
HTTP contract without a model or a browser. A test also checks that real past
digest picks still pass `vetPicks()`.
