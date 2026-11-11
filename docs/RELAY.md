# Relay

`relay/` is an optional daemon that turns text into published memes. It
accepts either a chat transcript (`POST /forge`) or a request for the day's
news (`POST /digest`), has a language model choose a template and write the
captions, renders the result through the app itself, and publishes it to the
wall. The app does not depend on it; deleting `relay/` changes nothing else.

The model runs through the `claude` command-line tool, following the two skills
in [`.claude/skills/`](../.claude/skills/): `meme` (pick a template for a
situation) and `meme-news` (find stories and pick a template for each).

The text the model reads is written by other people: chat messages, and for
the digest, web pages. So the model only decides. It never runs commands,
reads files or calls the API; the relay does all of that itself and gives the
model the data inside its prompt. See [Trust boundary](#trust-boundary).

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
context ─► claude -p (no tools; skill + catalog + fenced chat) ─► {templateId, captions, title, alt}
        ─► GET /api/templates/<id>          ─► fit captions to the zone count
        ─► headless Chromium: /#/edit/<id>?c=…  ─► window.__mimema.exportPng()
        ─► POST /api/items (tags: relay, source)  ─► {slug, url, shareUrl}
```

1. **Pick.** The relay loads the template catalog from the live API, joins
   `scripts/meanings.json` onto it, and builds one prompt: the arguments, the
   catalog, and the transcript (its last 40,000 characters) between
   BEGIN/END markers carrying a random tag. The `meme` skill is appended to
   the system prompt. It runs
   `claude -p --restricted --tools "" --strict-mcp-config --permission-prompts none …`
   in an empty temporary directory, with the prompt on stdin and only `PATH`,
   `HOME`, locale and the CLI's own auth variables in the environment. The
   answer is extracted (a bare object, a fenced block, or the first balanced
   object in prose) and checked against a strict schema.
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

`POST /digest` runs the `meme-news` skill the same way, with `WebSearch` and
`WebFetch` as its only tools, a 300 s timeout and `MEME_NEWS_MODEL`. Each item
names a topic (`tech`, `internet`, `sports`, `culture`, `world`, `science`),
a joke shape and a reason, then a template and captions.

`vetPicks()` refuses a pick when:

- its captions share no name, number or product with the story's title and
  blurb;
- the template has an entry in `meanings.json` whose shapes do not include the
  pick's shape;
- another pick in the digest already uses the template or the topic.

If fewer than `count` picks survive, the model is asked once more for the
missing number, given a REDO block listing what was refused and why and what
is already taken. If nothing survives both rounds, the refused picks are
published anyway and the fact is logged. Each surviving pick then goes through
the same render and publish steps as `/forge`, one at a time, tagged `relay`,
`news`, its topic and `source`. A pick that fails to render becomes a line in
`errors`; the response is `500` only when no item was published.

Optional taste input: `exclude` (titles or URLs already posted, to skip), `interests` (a
standing description of what the audience likes, trimmed to 500 characters)
and `feedback` (up to 60 `{title, topic, up, down}` reaction counts on past
items; malformed entries are dropped). They go into the prompt as EXCLUDE
(at most 200 lines of 300 characters) and TASTE blocks.

## HTTP

Listens on `127.0.0.1` and `::1` at `MEME_RELAY_PORT` (8006). There is no
authentication: any local process can call it, and any local process running
as the same user can already read the key. Do not expose the port. Bodies are capped at 256 KB. Status codes are `200`, `400`, `429` and
`500` only.

| Route | Body | Response |
| --- | --- | --- |
| `GET /healthz` | | `ok` |
| `POST /forge` | `{context, source?, chatId?, dryRun?}` | `{slug, url, shareUrl, templateId, captions, title}` |
| `POST /digest` | `{count?, source?, exclude?, interests?, feedback?}` | `{items: [{title, blurb, sourceUrl, topic, templateId, captions, slug, url, shareUrl}], errors: string[]}` |

- `context` is the transcript: one `[HH:MM] name: text` line per message,
  optionally followed by a `--- request ---` line and a hint.
- `source` becomes a wall tag if it matches `[a-z0-9-]{1,32}`; otherwise it is
  dropped.
- `dryRun: true` picks and renders but does not publish, and answers
  `{dryRun, templateId, captions, title, bytes}`. Use it to check a deployed
  relay end to end without posting to the wall.
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

## Trust boundary

The chat and the web are untrusted. If a message or a page tells the model to
do something, the most it can change is the JSON it returns.

- **Tools.** The picker has none. The news desk has `WebSearch` and `WebFetch`,
  and fetching `localhost` or loopback addresses is denied. Shell, file,
  notebook and agent tools are on a deny list for every run. `--restricted`
  and `--strict-mcp-config` keep out the machine's own Claude settings,
  permission rules, hooks and MCP servers.
- **Prompt.** The catalog, transcript, exclude list, taste brief and redo
  notes go in BEGIN/END blocks with a random tag. Any marker-like text inside
  is defused, and the skill treats everything inside a block as data.
- **Output.** Picks must match a strict schema: only the known keys, a slug
  template id that exists in the catalog, at most 200 characters per caption,
  and an http(s) `sourceUrl`.
- **Environment.** The model's process does not get `.env` (or the
  `INVITE_KEY` in it).

A side effect: in relay mode the model can no longer open a template image to
check what it shows. It relies on the catalog line and the curated meanings.

## systemd

`deploy/meme-relay.service` is a systemd user unit for it. Install it like
`meme.service` (link it into `~/.config/systemd/user/`, then
`systemctl --user daemon-reload`). The sandbox:

- an empty, read-only home (`ProtectHome=tmpfs`), with only the checkout,
  the `claude` binary and the Playwright browsers mounted back in, all
  read-only. `/mnt`, `/media` and `/srv` are inaccessible;
- a private Claude config directory under `~/.local/state/meme-relay/claude`
  (`CLAUDE_CONFIG_DIR`). The user's `~/.claude.json` and `~/.claude/`
  settings, hooks and skills are not visible. Only the sign-in file
  `~/.claude/.credentials.json` is mounted in, so that refreshed tokens are
  shared with the user's own sessions;
- no new privileges, no capabilities, private `/tmp` and `/dev`, no
  namespaces, the `@system-service` syscall filter, and the kernel, clock
  and hostname protections.

Chromium runs without its own sandbox (Playwright's headless shell default),
so it needs no user namespaces. A user manager cannot install the BPF filter
`IPAddressDeny=` needs, so the unit does not keep the relay off the LAN. Run
it as a system unit if you need that. `systemd-analyze --user security
meme-relay.service` scores the unit about 1.4.

To check a deployed relay without publishing:

```sh
curl -s localhost:8006/forge -H 'content-type: application/json' \
  -d '{"context":"[09:00] dana: we deploy on fridays now","dryRun":true}'
```

## Tests

`pickMeme()` takes an injected runner and `createHandler()` an injected forge
and digest, so `relay/*.test.ts` exercise parsing, vetting, admission and the
HTTP contract without a model or a browser. `relay/security.test.ts` pins the
trust boundary. It checks that no tool list has a shell or file tool, the CLI
flags of each run, and that the untrusted text stays fenced. It also runs a
stand-in `claude` against a transcript full of injected instructions and
checks the run still gets no tools. A test also checks that real past
digest picks still pass `vetPicks()`.
