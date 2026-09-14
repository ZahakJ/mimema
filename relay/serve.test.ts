import { afterEach, describe, expect, it, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { readFile } from "node:fs/promises"
import {
  DIGEST_RETRY_MS,
  MAX_BODY_BYTES,
  QUEUE_RETRY_MS,
  cleanSource,
  createHandler,
  type DigestFn,
  type ForgeFn,
} from "./serve.ts"
import { Gate } from "./gate.ts"
import type { ForgeResult, ForgeOpts } from "./forge.ts"
import { MAX_FEEDBACK, MAX_INTERESTS_CHARS, type DigestOpts, type DigestResult } from "./digest.ts"

const RESULT: ForgeResult = {
  slug: "abc123",
  url: "https://meme.example/m/abc123.png",
  shareUrl: "https://meme.example/m/abc123",
  templateId: "drake",
  captions: ["a", "b"],
  title: "Define backups",
  pngBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
}

const DIGEST_ITEM = {
  title: "Cloud provider calls its own outage unprecedented",
  blurb: "Per Reuters, a config push took the region down for four hours.",
  sourceUrl: "https://example.com/news/outage",
  topic: "tech" as const,
  templateId: "this-is-fine",
  captions: ["everything is on fire", "this is fine"],
  slug: "abc123",
  url: "https://meme.example/m/abc123.png",
  shareUrl: "https://meme.example/m/abc123",
}

const DIGEST: DigestResult = { items: [DIGEST_ITEM], errors: [] }

/** a server on an ephemeral port with a fake forge — never touches claude or chromium */
async function serve(opts: { forge?: ForgeFn; digest?: DigestFn; gate?: Gate } = {}) {
  const forge = opts.forge ?? (async () => RESULT)
  const digest = opts.digest ?? (async () => DIGEST)
  const server = http.createServer(createHandler({ forge, digest, ...(opts.gate ? { gate: opts.gate } : {}) }))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const { port } = server.address() as AddressInfo
  open.push(server)
  const at = (route: string) => (body: string | object, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    })
  return { base: `http://127.0.0.1:${port}`, post: at("/forge"), digest: at("/digest") }
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

describe("POST /digest", () => {
  it("returns the items and the errors array", async () => {
    const { digest } = await serve()
    const res = await digest({})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [DIGEST_ITEM], errors: [] })
  })

  it("405s a GET", async () => {
    const { base } = await serve()
    expect((await fetch(`${base}/digest`)).status).toBe(405)
  })

  it("defaults count to 2 and passes exclude and a source through", async () => {
    const calls: (DigestOpts | undefined)[] = []
    const fn: DigestFn = async (opts) => (calls.push(opts), DIGEST)
    const { digest } = await serve({ digest: fn })
    await digest({})
    await digest({ count: 4, exclude: ["old headline"], source: "Discord" })
    expect(calls[0]).toMatchObject({ count: 2, exclude: [] })
    expect(calls[1]).toMatchObject({ count: 4, exclude: ["old headline"], source: "discord" })
  })

  it("passes interests and feedback through, defaulting to none", async () => {
    const calls: (DigestOpts | undefined)[] = []
    const fn: DigestFn = async (opts) => (calls.push(opts), DIGEST)
    const { digest } = await serve({ digest: fn })
    await digest({})
    const feedback = [
      { title: "Cardinals Stun Chargers", topic: "sports", up: 1, down: 4 },
      { title: "Level-5 CEO Says Sorry For AI", topic: "culture", up: 6, down: 0 },
    ]
    await digest({ count: 2, interests: "medicine, science, tech", feedback })
    expect(calls[0]).toMatchObject({ interests: null, feedback: [] })
    expect(calls[1]).toMatchObject({ count: 2, interests: "medicine, science, tech", feedback })
  })

  it("drops malformed feedback entries silently and keeps the good ones", async () => {
    const calls: (DigestOpts | undefined)[] = []
    const fn: DigestFn = async (opts) => (calls.push(opts), DIGEST)
    const { digest } = await serve({ digest: fn })
    const res = await digest({
      feedback: [
        { title: "fine", topic: "tech", up: 1, down: 0 },
        { title: "no counts", topic: "tech" },
        { title: 5, topic: "tech", up: 1, down: 0 },
        { title: "negative", topic: "tech", up: -1, down: 0 },
        "junk",
        null,
      ],
    })
    expect(res.status).toBe(200)
    expect(calls[0]?.feedback).toEqual([{ title: "fine", topic: "tech", up: 1, down: 0 }])
  })

  it("keeps at most MAX_FEEDBACK entries", async () => {
    const calls: (DigestOpts | undefined)[] = []
    const fn: DigestFn = async (opts) => (calls.push(opts), DIGEST)
    const { digest } = await serve({ digest: fn })
    const feedback = Array.from({ length: MAX_FEEDBACK + 5 }, (_, i) => ({ title: `s${i}`, topic: "tech", up: i, down: 0 }))
    expect((await digest({ feedback })).status).toBe(200)
    expect(calls[0]?.feedback).toHaveLength(MAX_FEEDBACK)
  })

  it("400s on a non-array feedback or a non-string interests", async () => {
    const fn = vi.fn<DigestFn>(async () => DIGEST)
    const { digest } = await serve({ digest: fn })
    for (const body of [{ feedback: "no" }, { feedback: {} }, { feedback: 3 }, { interests: 3 }, { interests: ["a"] }]) {
      const res = await digest(body)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: expect.stringMatching(/feedback|interests/) })
    }
    expect(fn).not.toHaveBeenCalled()
  })

  it("trims over-long interests to the cap instead of refusing them", async () => {
    const calls: (DigestOpts | undefined)[] = []
    const fn: DigestFn = async (opts) => (calls.push(opts), DIGEST)
    const { digest } = await serve({ digest: fn })
    expect((await digest({ interests: "m".repeat(MAX_INTERESTS_CHARS * 3) })).status).toBe(200)
    expect(calls[0]?.interests).toHaveLength(MAX_INTERESTS_CHARS)
    expect(calls[0]?.interests?.endsWith("…")).toBe(true)
  })

  it("treats null and blank taste fields as absent", async () => {
    const calls: (DigestOpts | undefined)[] = []
    const fn: DigestFn = async (opts) => (calls.push(opts), DIGEST)
    const { digest } = await serve({ digest: fn })
    expect((await digest({ interests: null, feedback: null })).status).toBe(200)
    expect((await digest({ interests: "   ", feedback: [] })).status).toBe(200)
    expect(calls[0]).toMatchObject({ interests: null, feedback: [] })
    expect(calls[1]).toMatchObject({ interests: null, feedback: [] })
  })

  it("accepts an empty body as the defaults", async () => {
    const { base } = await serve()
    const res = await fetch(`${base}/digest`, { method: "POST" })
    expect(res.status).toBe(200)
  })

  it("400s on a count out of range or the wrong shape", async () => {
    const fn = vi.fn<DigestFn>(async () => DIGEST)
    const { digest } = await serve({ digest: fn })
    for (const body of [{ count: 0 }, { count: 5 }, { count: 2.5 }, { count: "2" }, { count: null }]) {
      expect((await digest(body)).status).toBe(400)
    }
    expect(fn).not.toHaveBeenCalled()
  })

  it("400s on malformed JSON, a non-object body, a bad exclude or a bad source", async () => {
    const { digest } = await serve()
    expect((await digest("{not json")).status).toBe(400)
    expect((await digest([])).status).toBe(400)
    expect((await digest({ exclude: "old headline" })).status).toBe(400)
    expect((await digest({ exclude: [1, 2] })).status).toBe(400)
    expect((await digest({ source: 7 })).status).toBe(400)
  })

  it("429s busy while one is already running, and frees up after", async () => {
    let release!: () => void
    const blocked = new Promise<void>((r) => (release = r))
    const fn: DigestFn = async () => {
      await blocked
      return DIGEST
    }
    const { digest } = await serve({ digest: fn })
    const inflight = digest({})
    await vi.waitFor(async () => {
      const res = await digest({})
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ error: "busy", retryAfterMs: DIGEST_RETRY_MS })
    })
    release()
    expect((await inflight).status).toBe(200)
    expect((await digest({})).status).toBe(200)
  })

  it("500s when nothing forged, naming the first reason", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const fn: DigestFn = async () => ({ items: [], errors: ["headline: posting to the wall failed: 401"] })
    const { digest } = await serve({ digest: fn })
    const res = await digest({})
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "headline: posting to the wall failed: 401" })
    expect(err).toHaveBeenCalled()
  })

  it("500s with one line when the pick step throws, and stays usable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    let boom = true
    const fn: DigestFn = async () => {
      if (boom) throw new Error("claude timed out after 300000ms\nstack\nlines")
      return DIGEST
    }
    const { digest } = await serve({ digest: fn })
    const res = await digest({})
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "claude timed out after 300000ms" })
    boom = false
    expect((await digest({})).status).toBe(200)
  })
})
