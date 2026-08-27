# Security Policy

## Reporting a vulnerability

There is no bug bounty. There is gratitude, and credit if you want it.

Use GitHub's **private vulnerability reporting** (Security → Report a
vulnerability) for anything exploitable. For low-risk or already-public issues,
a normal GitHub issue is fine. Please don't disclose an exploitable finding
publicly before it's patched.

Expect a reply when the maintainer is next at a keyboard. This is a side
project; there is no on-call rotation.

## Threat model

mimema is a public, hotlinkable media host. Assume everything served is world
readable, forever.

- **Read is public; write is gated.** Listing items, fetching media, and
  fetching templates need no credentials. Publishing, uploading, adding
  templates, and deleting require the shared `INVITE_KEY`, sent as the
  `x-meme-key` header and compared with a constant-time hash comparison. An
  empty `INVITE_KEY` disables all writes.
- **The invite key is a shared passphrase, not an identity.** There are no user
  accounts. Anyone holding the key can publish or delete. Rotate it by editing
  `.env` and restarting.
- **MIME is decided server-side.** `server/sniff.ts` reads magic bytes;
  client-declared content types are discarded. Stored extension, stored MIME,
  and served `Content-Type` all come from the sniff.
- **SVG is deliberately unsupported.** It is scriptable XML, and this host
  serves attacker-supplied bytes from its own origin. There is no plan to add
  it.
- `X-Content-Type-Options: nosniff` on every response; a restrictive CSP on
  every HTML response; upload size caps for images and video.
- **Out of scope:** anything requiring the invite key to exploit, denial of
  service by filling the disk, and the contents of the memes themselves.

## Deployment note

By default the server binds loopback only (`127.0.0.1`, plus `::1` so tunnels
that resolve `localhost` to IPv6 can reach it) and expects a reverse proxy or
tunnel in front of it for TLS. Setting `HOST` to a wider interface is your call
and your threat model.
