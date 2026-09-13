#!/usr/bin/env node
/**
 * The relay daemon: a loopback HTTP front door for the forge.
 *
 * Mimema has no chat surface of its own. Binary — the user's Go Discord bot —
 * gathers the transcript, formats it, and POSTs it here; this process owns the
 * model call, the headless render and the INVITE_KEY. That split is the point:
 * the secret and the browser stay on this side of localhost, and the chat
 * adapter stays a separate program that only needs to speak JSON.
 *
 *   GET  /healthz → "ok"
 *   POST /forge   → { context, source?, chatId? } → { slug, url, shareUrl,
 *                    templateId, captions, title }
 *
 * No auth: the socket is loopback-only, so anything that can reach it can
 * already read .env. Do not bind a routable address.
 */
import http from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Gate, seconds } from "./gate.ts"
import { closeBrowser, forge as realForge, type ForgeOpts, type ForgeResult } from "./forge.ts"

export const DEFAULT_PORT = 8006
/** Binary formats the transcript; 256 KB is far more chat than the picker can read */
export const MAX_BODY_BYTES = 256 * 1024
/** a source tag lands on a public wall item, so it is a slug or it is nothing */
export const SOURCE_RE = /^[a-z0-9-]{1,32}$/
/** what to tell a caller the queue is full for, when the cooldown is disabled */
export const QUEUE_RETRY_MS = 5_000

export type ForgeFn = (contextPath: string, opts?: ForgeOpts) => Promise<ForgeResult>

export type HandlerDeps = {
  /** injected by the tests so they never touch `claude` or a browser */
  forge?: ForgeFn
  gate?: Gate
}

export type ForgeRequest = { context: string; source?: string; chatId?: string }

/**
 * Lowercase slug or nothing: a source we cannot vouch for is dropped rather
 * than mangled, because the tag is visible on the wall next to `relay`.
 */
export function cleanSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const tag = raw.trim().toLowerCase()
  return SOURCE_RE.test(tag) ? tag : null
}

/** one line, bounded — the caller puts this in a chat message */
export function oneLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return (msg.split("\n")[0] ?? "forge failed").slice(0, 200) || "forge failed"
}

class BadRequest extends Error {}

/** read the body with a hard cap; a flood is refused, not buffered */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // 400, not 413: the contract with Binary is 200/400/429/500 and nothing else
        reject(new BadRequest(`body too large (max ${MAX_BODY_BYTES} bytes)`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

export function parseForgeRequest(raw: string): ForgeRequest {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new BadRequest("body is not valid JSON")
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequest("body must be a JSON object")
  }
  const { context, source, chatId } = body as Record<string, unknown>
  if (typeof context !== "string" || context.trim() === "") {
    throw new BadRequest("context must be a non-empty string")
  }
  if (source !== undefined && typeof source !== "string") throw new BadRequest("source must be a string")
  if (chatId !== undefined && typeof chatId !== "string") throw new BadRequest("chatId must be a string")
  return { context, ...(source === undefined ? {} : { source }), ...(chatId === undefined ? {} : { chatId }) }
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "x-content-type-options": "nosniff",
    ...headers,
  })
  res.end(json)
}

export function createHandler(deps: HandlerDeps = {}): http.RequestListener {
  const forge = deps.forge ?? realForge
  const gate =
    deps.gate ?? new Gate({ cooldownMs: Number(process.env.MEME_RELAY_COOLDOWN_MS) || undefined })

  return (req, res) => {
    void handle(req, res).catch((err) => {
      console.error("[relay] handler:", err)
      if (!res.headersSent) send(res, 500, { error: oneLine(err) })
      else res.end()
    })
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = (req.url ?? "/").split("?")[0] ?? "/"

    if (url === "/healthz") {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" })
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" })
      res.end("ok")
      return
    }
    if (url !== "/forge") return send(res, 404, { error: "not found" })
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" })

    let request: ForgeRequest
    try {
      request = parseForgeRequest(await readBody(req))
    } catch (err) {
      if (err instanceof BadRequest) return send(res, 400, { error: err.message })
      throw err
    }

    // the gate is a cost guard, not an ACL: one room cannot burn a model call
    // per second, and the whole daemon runs one forge at a time
    const chatId = request.chatId?.trim() || "anon"
    const admission = gate.admit(chatId)
    if (!admission.ok) {
      const retryAfterMs =
        admission.reason === "cooldown" ? admission.retryInMs : gate.cooldownMs || QUEUE_RETRY_MS
      return send(
        res,
        429,
        { error: admission.reason === "cooldown" ? "cooling down" : "queue full", retryAfterMs },
        { "retry-after": String(seconds(retryAfterMs)) },
      )
    }

    const source = cleanSource(request.source)
    try {
      // everything after admit() goes through run(), or the queue slot leaks
      const result = await gate.run(async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "mimema-relay-"))
        const contextPath = path.join(dir, "context.txt")
        try {
          await writeFile(contextPath, request.context, "utf8")
          return await forge(contextPath, { tags: source ? [source] : [] })
        } finally {
          // the transcript is someone else's chat: it lives only as long as the forge
          await rm(dir, { recursive: true, force: true }).catch(() => undefined)
        }
      }, chatId)
      // pngBytes stays here: Binary fetches the image from the wall URL
      const { pngBytes: _png, ...dto } = result
      console.log(`[relay] ${chatId} → ${result.templateId} → ${result.shareUrl}`)
      send(res, 200, dto)
    } catch (err) {
      console.error("[relay] forge failed:", err)
      send(res, 500, { error: oneLine(err) })
    }
  }
}

/**
 * Bind 127.0.0.1 and ::1, the way server/index.ts does: a client that resolves
 * "localhost" to ::1 first (most of them) finds nothing on IPv4 alone.
 */
export async function listen(port: number, deps: HandlerDeps = {}): Promise<http.Server[]> {
  const handler = createHandler(deps)
  const servers = await Promise.all(
    ["127.0.0.1", "::1"].map(
      (host) =>
        new Promise<http.Server>((resolve, reject) => {
          const server = http.createServer(handler)
          server.once("error", reject)
          server.listen(port, host, () => {
            server.removeListener("error", reject)
            console.log(`[relay] listening on http://${host.includes(":") ? `[${host}]` : host}:${port}`)
            resolve(server)
          })
        }),
    ),
  )
  return servers
}

if (import.meta.main) {
  const port = Number(process.env.MEME_RELAY_PORT) || DEFAULT_PORT
  const servers = await listen(port)
  let closing = false
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      if (closing) return
      closing = true
      // stop accepting first, then let the browser singleton go
      void Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))))
        .then(() => closeBrowser())
        .then(() => process.exit(0))
    })
  }
}
