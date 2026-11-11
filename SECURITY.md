# Security

Report exploitable issues through GitHub private vulnerability reporting
(Security → Report a vulnerability). Low-risk issues can go in a normal issue.

## Model

Everything served is public.

- Reads need no credentials. Publishing, uploading, adding templates and
  deleting need `INVITE_KEY`, sent as `x-meme-key` and compared in constant
  time. Empty `INVITE_KEY` disables writes.
- The key is a shared passphrase; there are no accounts. Rotate it by editing
  `.env` and restarting.
- Type, extension and `Content-Type` come from magic bytes in
  `server/sniff.ts`. SVG is not accepted.
- `X-Content-Type-Options: nosniff` on every response, a restrictive CSP on
  HTML, and upload size caps.
- The server binds loopback (`127.0.0.1`, `::1`) and expects a TLS proxy in
  front. Rate limits trust `CF-Connecting-IP`.
- The optional relay (`relay/`) feeds chat messages and web pages to a
  language model. That text is treated as untrusted. The model has no shell
  or file tools, and the news desk has only web search and fetch. The relay
  does every fetch, render and write itself and validates the model's JSON
  against a strict schema. Its systemd unit runs with an empty home and a
  private CLI config. Details: [docs/RELAY.md](docs/RELAY.md#trust-boundary).
- Out of scope: attacks that need the key, filling the disk, meme content.
