import { afterEach, describe, expect, it, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { readFile } from "node:fs/promises"
import { MAX_BODY_BYTES, QUEUE_RETRY_MS, cleanSource, createHandler, type ForgeFn } from "./serve.ts"
import { Gate } from "./gate.ts"
import type { ForgeResult, ForgeOpts } from "./forge.ts"

const RESULT: ForgeResult = {
  slug: "abc123",
  url: "https://meme.example/m/abc123.png",
  shareUrl: "https://meme.example/m/abc123",
  templateId: "drake",
  captions: ["a", "b"],
  title: "Define backups",
  pngBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
}

/** a server on an ephemeral port with a fake forge — never touches claude or chromium */
async function serve(opts: { forge?: ForgeFn; gate?: Gate } = {}) {
  const forge = opts.forge ?? (async () => RESULT)
  const server = http.createServer(createHandler({ forge, ...(opts.gate ? { gate: opts.gate } : {}) }))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  open.push(server)
  return {
    base: `http://127.0.0.1:${port}`,
    post: (body: string | object, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}/forge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
        ...init,
      }),
  }
}

const open: http.Server[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
  vi.restoreAllMocks()
})

describe("GET /healthz", () => {
  it("answers ok", async () => {
    const { base } = await serve()
    const res = await fetch(`${base}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("ok")
  })

  it("404s anything else", async () => {
    const { base } = await serve()
    expect((await fetch(`${base}/`)).status).toBe(404)
    expect((await fetch(`${base}/forge`)).status).toBe(405)
  })
})

describe("POST /forge — bad input", () => {
  it("400s on malformed JSON", async () => {
    const { post } = await serve()
    const res = await post("{not json")
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("JSON") })
  })

  it("400s on a missing, empty or whitespace context", async () => {
    const { post } = await serve()
    for (const body of [{}, { context: "" }, { context: "   " }, { context: 42 }, []]) {
      expect((await post(body)).status).toBe(400)
    }
  })

  it("400s on a non-string source or chatId", async () => {
    const { post } = await serve()
    expect((await post({ context: "hi", source: 7 })).status).toBe(400)
    expect((await post({ context: "hi", chatId: {} })).status).toBe(400)
  })

  it("refuses a body over the cap instead of buffering it", async () => {
    const forge = vi.fn(async () => RESULT)
    const { post } = await serve({ forge })
    const huge = JSON.stringify({ context: "x".repeat(MAX_BODY_BYTES + 1024) })
    const res = await post(huge).catch(() => null)
    // the socket may be torn down mid-upload; either way nothing is forged
    if (res) expect(res.status).toBe(400)
    expect(forge).not.toHaveBeenCalled()
  })
})

describe("POST /forge — the happy path", () => {
  it("returns the forge DTO without the PNG bytes", async () => {
    const { post } = await serve()
    const res = await post({ context: "[09:00] dana: ship it" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      slug: "abc123",
      url: "https://meme.example/m/abc123.png",
      shareUrl: "https://meme.example/m/abc123",
      templateId: "drake",
      captions: ["a", "b"],
      title: "Define backups",
    })
    expect(body).not.toHaveProperty("pngBytes")
  })

  it("writes the context to a temp file the forge can read, then removes it", async () => {
    const seen: { path: string; text: string }[] = []
    const forge: ForgeFn = async (contextPath) => {
      seen.push({ path: contextPath, text: await readFile(contextPath, "utf8") })
      return RESULT
    }
    const { post } = await serve({ forge })
    await post({ context: "[09:00] dana: ship it\n--- request ---\nmake it hurt" })
    expect(seen[0]?.text).toBe("[09:00] dana: ship it\n--- request ---\nmake it hurt")
    const leftover = await readFile(seen[0]!.path, "utf8").catch(() => null)
    expect(leftover).toBeNull()
  })

  it("tags the wall item with a sanitized source and drops a dirty one", async () => {
    const calls: ForgeOpts[] = []
    const forge: ForgeFn = async (_p, opts = {}) => {
      calls.push(opts)
      return RESULT
    }
    const gate = new Gate({ cooldownMs: 0 })
    const { post } = await serve({ forge, gate })
    await post({ context: "hi", source: " Discord " })
    await post({ context: "hi", source: "slack chat!" })
    await post({ context: "hi" })
    expect(calls.map((c) => c.tags)).toEqual([["discord"], [], []])
  })

  it("sanitizes a source to a lowercase slug or nothing", () => {
    expect(cleanSource("Discord")).toBe("discord")
    expect(cleanSource("go-binary")).toBe("go-binary")
    expect(cleanSource("../etc")).toBeNull()
    expect(cleanSource("a b")).toBeNull()
    expect(cleanSource("")).toBeNull()
    expect(cleanSource("x".repeat(33))).toBeNull()
    expect(cleanSource(undefined)).toBeNull()
  })
})

describe("POST /forge — the gate", () => {
  it("429s a chat inside its cooldown, with a retryAfterMs", async () => {
    const gate = new Gate({ cooldownMs: 30_000 })
    const { post } = await serve({ gate })
    expect((await post({ context: "hi", chatId: "c1" })).status).toBe(200)
    const res = await post({ context: "hi", chatId: "c1" })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe("cooling down")
    expect(body.retryAfterMs).toBeGreaterThan(0)
    expect(body.retryAfterMs).toBeLessThanOrEqual(30_000)
    expect(res.headers.get("retry-after")).toBeTruthy()
    // a different room is unaffected
    expect((await post({ context: "hi", chatId: "c2" })).status).toBe(200)
  })

  it("keys the cooldown by chatId, defaulting to anon", async () => {
    const gate = new Gate({ cooldownMs: 30_000 })
    const { post } = await serve({ gate })
    expect((await post({ context: "hi" })).status).toBe(200)
    expect((await post({ context: "hi", chatId: "  " })).status).toBe(429)
  })

  it("429s queue full once the waiting line is at the cap", async () => {
    const gate = new Gate({ cooldownMs: 0, maxWaiting: 1 })
    let release!: () => void
    const blocked = new Promise<void>((r) => (release = r))
    const forge: ForgeFn = async () => {
      await blocked
      return RESULT
    }
    const { post } = await serve({ forge, gate })
    // one forge running, one waiting — the next caller is turned away
    const inflight = [post({ context: "a" }), post({ context: "b" })]
    await vi.waitFor(() => expect(gate.waiting).toBe(1))
    const res = await post({ context: "c" })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: "queue full", retryAfterMs: QUEUE_RETRY_MS })
    release()
    await Promise.all(inflight)
  })
})

describe("POST /forge — failure", () => {
  it("500s with a one-line message and logs the whole thing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const forge: ForgeFn = async () => {
      throw new Error("posting to the wall failed: 401\nmultiple\nlines")
    }
    const { post } = await serve({ forge })
    const res = await post({ context: "hi" })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "posting to the wall failed: 401" })
    expect(err).toHaveBeenCalled()
  })

  it("frees the queue slot after a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const gate = new Gate({ cooldownMs: 0, maxWaiting: 1 })
    const forge: ForgeFn = async () => {
      throw new Error("boom")
    }
    const { post } = await serve({ forge, gate })
    expect((await post({ context: "a" })).status).toBe(500)
    expect(gate.waiting).toBe(0)
    expect((await post({ context: "b" })).status).toBe(500)
  })
})
