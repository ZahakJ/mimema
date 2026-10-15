# Deployment

Mimema is one Node process holding a SQLite file and a directory of media. It
binds loopback only; put a TLS reverse proxy or a tunnel in front of it.

## Build and run

```sh
npm ci
npm run templates && npm run templates:layouts
cp .env.example .env        # set INVITE_KEY and PUBLIC_ORIGIN
npm run build               # client → dist/
npm start                   # node --env-file-if-exists=.env server/index.ts
curl http://127.0.0.1:8001/healthz && curl 'http://[::1]:8001/healthz'
```

The server needs no build: Node 26 strips the TypeScript types at load time,
so `server/` and `shared/` use only erasable syntax. `dist/` must be rebuilt
after a client change; the server reads `dist/index.html` once at startup, so
restart it afterwards.

## Configuration

Environment variables, read from `.env` by `--env-file-if-exists`.

| Variable | Default | |
| --- | --- | --- |
| `INVITE_KEY` | empty | key for every write; empty disables writes. The server warns below 12 characters. |
| `HOST` | `127.0.0.1` | bind address; with the default, `::1` is bound as well |
| `PORT` | `8001` | |
| `PUBLIC_ORIGIN` | `http://localhost:<PORT>` | origin used in OpenGraph URLs on share pages |
| `DATA_DIR` | `./data` | `mimema.sqlite`, `media/`, `templates/` |
| `ALLOW_VIDEO` | `1` | `0` refuses MP4 and WebM |
| `RATE_LIMIT` | `1` | `0` disables rate limiting |
| `RATE_LIMIT_VERIFY` | `10` | key checks per window per IP |
| `RATE_LIMIT_WRITE` | `30` | writes per window per IP |
| `RATE_LIMIT_READ` | `120` | `GET /api/*` per window per IP |
| `RATE_LIMIT_REACT` | `60` | reactions per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | window length |

A suitable key: `openssl rand -base64 24`. The relay's variables are in
[RELAY.md](RELAY.md#configuration).

## Behind a proxy

- **IPv6 loopback.** Some proxies, `cloudflared` among them, resolve
  `localhost` to `::1` first. The server binds both `127.0.0.1` and `::1` when
  `HOST` is left at its default; binding only one gives a 502 through such a
  proxy.
- **Client IP.** Rate limits key on `CF-Connecting-IP` when the header is
  present, else the socket address. Behind a proxy that does not set that
  header, every client shares the proxy's address and therefore one bucket.
  The header is trusted only because the server is unreachable except through
  the proxy; do not bind a public address.
- **HTTPS.** HSTS is sent on every response and takes effect once the site is
  served over HTTPS.
- **Caching.** `/m/<slug>.<ext>`, `/t/<id>.<ext>` and `/assets/*` are
  immutable for a year. `/`, `index.html` and share pages are `no-cache`.

## systemd

`deploy/meme.service` is a user unit with a restrictive sandbox: read-only
home except `data/`, no new privileges, a `@system-service` syscall filter,
1 GB memory cap. Edit `WorkingDirectory` and `ReadWritePaths` to match the
checkout, and remove `PartOf=` if no such target exists.

```sh
ln -s "$PWD/deploy/meme.service" ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now meme.service
npm run build && systemctl --user restart meme.service   # after a client change
journalctl --user -u meme.service -f
```

`deploy/meme-relay.service` runs the relay; see [RELAY.md](RELAY.md).

## Data

Everything lives in `DATA_DIR`. Back up `mimema.sqlite` together with
`media/`; `templates/` can be fetched again, but custom templates exist only
there. The database is in WAL mode, so copy it with `sqlite3 mimema.sqlite
".backup out.sqlite"` while the server runs, or stop it first. Migrations run
automatically at startup.
