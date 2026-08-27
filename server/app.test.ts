import { afterAll, beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Hono } from "hono"
import { openDb } from "./db.ts"
import { createApp } from "./app.ts"
import { loadConfig } from "./config.ts"
import type { ItemDto, TemplateDto } from "../shared/schema.ts"

const KEY = "test-passphrase"
const ORIGIN = "https://memes.example.com"

// Synthetic but sniffable+sizable PNG: real signature, IHDR at the right
// offset with 320x200 dims. Doesn't need to be decodable server-side.
function fakePng(extra = 0): Uint8Array {
  const buf = new Uint8Array(64 + extra)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  buf.set([0x00, 0x00, 0x00, 0x0d], 8)
  buf.set([0x49, 0x48, 0x44, 0x52], 12) // IHDR
  new DataView(buf.buffer).setUint32(16, 320)
  new DataView(buf.buffer).setUint32(20, 200)
  buf[63 + extra] = extra % 251
  return buf
}

function fakeMp4(): Uint8Array {
  const buf = new Uint8Array(64)
  buf.set([0x00, 0x00, 0x00, 0x18], 0)
  buf.set([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 4) // ftypisom
  return buf
}

let app: Hono
let dataDir: string

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimema-test-"))
  // RATE_LIMIT=0 — the limiter has its own tests; these must not trip it
  const config = loadConfig({
    DATA_DIR: dataDir,
    INVITE_KEY: KEY,
    PUBLIC_ORIGIN: ORIGIN,
    RATE_LIMIT: "0",
  })
  const db = openDb(path.join(dataDir, "mimema.sqlite"))
  app = createApp(config, db).app
})

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function upload(
  bytes: Uint8Array,
  opts: { key?: string; kind?: string; title?: string; templateId?: string; tags?: string } = {},
) {
  const form = new FormData()
  form.set("file", new File([bytes as BlobPart], "x.bin"))
  if (opts.kind) form.set("kind", opts.kind)
  if (opts.title) form.set("title", opts.title)
  if (opts.templateId) form.set("templateId", opts.templateId)
  if (opts.tags) form.set("tags", opts.tags)
  return app.request("/api/items", {
    method: "POST",
    body: form,
    headers: opts.key ? { "x-meme-key": opts.key } : {},
  })
}

describe("mimema api", () => {
  it("health", async () => {
    expect((await app.request("/healthz")).status).toBe(200)
  })

  it("verify-key gate", async () => {
    expect((await app.request("/api/verify-key", { method: "POST" })).status).toBe(401)
    expect(
      (
        await app.request("/api/verify-key", {
          method: "POST",
          headers: { "x-meme-key": KEY },
        })
      ).status,
    ).toBe(204)
  })

  it("rejects uploads without the key", async () => {
    expect((await upload(fakePng())).status).toBe(401)
  })

  it("rejects unsniffable bytes", async () => {
    const junk = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect((await upload(junk, { key: KEY })).status).toBe(415)
  })

  it("uploads a png, serves raw bytes + share page + range", async () => {
    const res = await upload(fakePng(1), { key: KEY, title: "test fly", kind: "upload" })
    expect(res.status).toBe(201)
    const item = (await res.json()) as ItemDto
    expect(item.slug).toMatch(/^[a-z]+-[a-z0-9-]+$/)
    expect(item.mime).toBe("image/png")
    expect(item.width).toBe(320)
    expect(item.height).toBe(200)

    const raw = await app.request(item.url)
    expect(raw.status).toBe(200)
    expect(raw.headers.get("content-type")).toBe("image/png")
    expect(raw.headers.get("cache-control")).toContain("immutable")

    const share = await app.request(item.shareUrl)
    expect(share.status).toBe(200)
    const html = await share.text()
    expect(html).toContain(`og:image`)
    expect(html).toContain(`${ORIGIN}${item.url}`)
    expect(html).toContain("test fly")

    const partial = await app.request(item.url, { headers: { range: "bytes=0-7" } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get("content-range")).toMatch(/^bytes 0-7\//)
    expect(new Uint8Array(await partial.arrayBuffer()).length).toBe(8)
  })

  it("dedups identical bytes to the same slug, and says so", async () => {
    const first = await upload(fakePng(7), { key: KEY })
    const a = (await first.json()) as ItemDto
    expect(first.status).toBe(201)
    expect(a.deduped).toBeUndefined()

    const second = await upload(fakePng(7), { key: KEY })
    const b = (await second.json()) as ItemDto
    expect(second.status).toBe(200)
    expect(b.deduped).toBe(true)
    expect(b.slug).toBe(a.slug)
  })

  it("serves a single item as json", async () => {
    const item = (await (await upload(fakePng(11), { key: KEY })).json()) as ItemDto
    const res = await app.request(`/api/items/${item.slug}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as ItemDto).slug).toBe(item.slug)

    const missing = await app.request("/api/items/no-such-slug")
    expect(missing.status).toBe(404)
    expect((await missing.json()) as { error: string }).toEqual({ error: "not found" })
  })

  it("404s unmatched /api paths as json, not the SPA shell", async () => {
    const res = await app.request("/api/nope")
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect((await res.json()) as { error: string }).toEqual({ error: "not found" })
  })

  it("rejects oversized declared dimensions", async () => {
    const buf = fakePng(13)
    new DataView(buf.buffer).setUint32(16, 30000)
    expect((await upload(buf, { key: KEY })).status).toBe(422)
  })

  it("sets the hardening headers", async () => {
    const res = await app.request("/healthz")
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000")
    expect(res.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    )
  })

  it("accepts video and lists newest-first", async () => {
    const res = await upload(fakeMp4(), { key: KEY, title: "ducks" })
    expect(res.status).toBe(201)
    const item = (await res.json()) as ItemDto
    expect(item.mime).toBe("video/mp4")

    const page = (await (await app.request("/api/items?limit=2")).json()) as {
      items: ItemDto[]
      nextCursor: string | null
    }
    expect(page.items[0]!.slug).toBe(item.slug)
  })

  it("searches by title", async () => {
    const page = (await (await app.request("/api/items?q=ducks")).json()) as { items: ItemDto[] }
    expect(page.items.length).toBe(1)
    expect(page.items[0]!.title).toBe("ducks")
  })

  it("creates and serves a custom template, then deletes it", async () => {
    const form = new FormData()
    form.set("image", new File([fakePng(9) as BlobPart], "aib.png"))
    form.set(
      "meta",
      JSON.stringify({ name: "Wait What", zones: [{ x: 0.05, y: 0.02, w: 0.9, h: 0.25 }] }),
    )
    const res = await app.request("/api/templates", {
      method: "POST",
      body: form,
      headers: { "x-meme-key": KEY },
    })
    expect(res.status).toBe(201)
    const tpl = (await res.json()) as TemplateDto
    expect(tpl.id).toBe("wait-what")
    expect(tpl.width).toBe(320)
    expect(tpl.zones[0]!.style.fontFamily).toBe("Anton")

    const img = await app.request(tpl.imageUrl)
    expect(img.status).toBe(200)

    const del = await app.request(`/api/templates/${tpl.id}`, {
      method: "DELETE",
      headers: { "x-meme-key": KEY },
    })
    expect(del.status).toBe(204)
    expect((await app.request(tpl.imageUrl)).status).toBe(404)
  })

  it("deletes items with the key only", async () => {
    const item = (await (await upload(fakePng(3), { key: KEY })).json()) as ItemDto
    expect((await app.request(`/api/items/${item.slug}`, { method: "DELETE" })).status).toBe(401)
    expect(
      (
        await app.request(`/api/items/${item.slug}`, {
          method: "DELETE",
          headers: { "x-meme-key": KEY },
        })
      ).status,
    ).toBe(204)
    expect((await app.request(item.url)).status).toBe(404)
  })
})

// tags/reactions/sorting get their own database so ordering assertions don't
// ride on how many items the suites above happened to leave behind
describe("tags, reactions, sorting", () => {
  let wall: Hono
  let dir: string
  const slugs: string[] = []

  const post = (path: string, body: unknown, key?: string) =>
    wall.request(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(key ? { "x-meme-key": key } : {}) },
    })

  const patch = (slug: string, body: unknown, key?: string) =>
    wall.request(`/api/items/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(key ? { "x-meme-key": key } : {}) },
    })

  const list = async (qs: string) =>
    (await (await wall.request(`/api/items${qs}`)).json()) as {
      items: ItemDto[]
      nextCursor: string | null
    }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimema-wall-"))
    const config = loadConfig({ DATA_DIR: dir, INVITE_KEY: KEY, RATE_LIMIT: "0" })
    wall = createApp(config, openDb(path.join(dir, "mimema.sqlite"))).app
    // three items, oldest first: alpha, beta, gamma
    for (const [i, name] of ["alpha", "beta", "gamma"].entries()) {
      const form = new FormData()
      form.set("file", new File([fakePng(100 + i) as BlobPart], "x.png"))
      form.set("title", name)
      form.set("tags", i === 2 ? "" : "dank")
      const res = await wall.request("/api/items", {
        method: "POST",
        body: form,
        headers: { "x-meme-key": KEY },
      })
      slugs.push(((await res.json()) as ItemDto).slug)
    }
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it("slugifies tags off the upload form", async () => {
    const form = new FormData()
    form.set("file", new File([fakePng(120) as BlobPart], "x.png"))
    form.set("tags", "Deep Fried, CURSED!!, deep fried, 💀")
    const res = await wall.request("/api/items", {
      method: "POST",
      body: form,
      headers: { "x-meme-key": KEY },
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as ItemDto).tags).toEqual(["cursed", "deep-fried"])
  })

  it("merges tags into the existing item on a dedup hit", async () => {
    const form = new FormData()
    form.set("file", new File([fakePng(120) as BlobPart], "x.png"))
    form.set("tags", "fresh")
    const res = await wall.request("/api/items", {
      method: "POST",
      body: form,
      headers: { "x-meme-key": KEY },
    })
    expect(res.status).toBe(200)
    const item = (await res.json()) as ItemDto
    expect(item.deduped).toBe(true)
    expect(item.tags).toEqual(["cursed", "deep-fried", "fresh"])
  })

  it("filters by tag, combinable with q", async () => {
    expect((await list("?tag=dank")).items.map((i) => i.title)).toEqual(["beta", "alpha"])
    expect((await list("?tag=dank&q=alpha")).items.map((i) => i.title)).toEqual(["alpha"])
    expect((await list("?tag=no-such-tag")).items).toEqual([])
  })

  it("counts tags, hottest first", async () => {
    const res = await wall.request("/api/tags")
    expect(res.status).toBe(200)
    const counts = (await res.json()) as { tag: string; count: number }[]
    expect(counts[0]).toEqual({ tag: "dank", count: 2 })
    expect(counts.map((t) => t.tag)).toEqual(expect.arrayContaining(["cursed", "deep-fried"]))
  })

  it("patches title and tags with the key", async () => {
    expect((await patch(slugs[2]!, { title: "nope" })).status).toBe(401)

    const res = await patch(slugs[2]!, { title: "gamma prime", tags: ["Rare Pepe", "dank"] }, KEY)
    expect(res.status).toBe(200)
    const item = (await res.json()) as ItemDto
    expect(item.title).toBe("gamma prime")
    expect(item.tags).toEqual(["dank", "rare-pepe"])

    // tags replace wholesale, title alone leaves them be
    const again = (await (await patch(slugs[2]!, { title: "gamma" }, KEY)).json()) as ItemDto
    expect(again.tags).toEqual(["dank", "rare-pepe"])
    const stripped = (await (await patch(slugs[2]!, { tags: [] }, KEY)).json()) as ItemDto
    expect(stripped.tags).toEqual([])
  })

  it("rejects a patch that says nothing, and 404s a missing slug", async () => {
    expect((await patch(slugs[0]!, {}, KEY)).status).toBe(422)
    const missing = await patch("no-such-slug", { title: "x" }, KEY)
    expect(missing.status).toBe(404)
    expect((await missing.json()) as { error: string }).toEqual({ error: "not found" })
  })

  it("reacts without a key and returns the running count", async () => {
    const first = await post(`/api/items/${slugs[1]}/react`, { emoji: "🔥" })
    expect(first.status).toBe(200)
    expect((await first.json()) as { emoji: string; count: number }).toMatchObject({
      emoji: "🔥",
      count: 1,
    })
    await post(`/api/items/${slugs[1]}/react`, { emoji: "🔥" })
    const third = (await (
      await post(`/api/items/${slugs[1]}/react`, { emoji: "💀" })
    ).json()) as { count: number; reactions: Record<string, number> }
    expect(third.count).toBe(1)
    expect(third.reactions).toEqual({ "🔥": 2, "💀": 1 })

    const item = (await (await wall.request(`/api/items/${slugs[1]}`)).json()) as ItemDto
    expect(item.reactions).toEqual({ "🔥": 2, "💀": 1 })
  })

  it("refuses an emoji outside the set, and a missing item", async () => {
    expect((await post(`/api/items/${slugs[1]}/react`, { emoji: "🍕" })).status).toBe(422)
    expect((await post(`/api/items/${slugs[1]}/react`, {})).status).toBe(422)
    expect((await post("/api/items/no-such-slug/react", { emoji: "🔥" })).status).toBe(404)
  })

  it("sorts new and old, paging correctly in both directions", async () => {
    const newest = await list("?sort=new")
    const oldest = await list("?sort=old")
    expect(oldest.items.map((i) => i.slug)).toEqual([...newest.items.map((i) => i.slug)].reverse())

    const walk = async (sort: string) => {
      const seen: string[] = []
      let cursor: string | null = null
      for (let guard = 0; guard < 20; guard++) {
        const page: { items: ItemDto[]; nextCursor: string | null } = await list(
          `?sort=${sort}&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
        )
        seen.push(...page.items.map((i) => i.slug))
        cursor = page.nextCursor
        if (!cursor) break
      }
      return seen
    }
    expect(await walk("old")).toEqual(oldest.items.map((i) => i.slug))
    expect(await walk("new")).toEqual(newest.items.map((i) => i.slug))
  })

  it("sorts top by reaction total, single page", async () => {
    await post(`/api/items/${slugs[0]}/react`, { emoji: "🗿" })
    const top = await list("?sort=top")
    // beta has three reactions, alpha one, the rest none
    expect(top.items[0]!.title).toBe("beta")
    expect(top.items[1]!.title).toBe("alpha")
    expect(top.nextCursor).toBeNull()
    expect((await list("?sort=top&limit=1")).nextCursor).toBeNull()
  })
})

describe("rate limiting", () => {
  let limited: Hono
  let dir: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimema-rl-"))
    const config = loadConfig({
      DATA_DIR: dir,
      INVITE_KEY: KEY,
      RATE_LIMIT_VERIFY: "2",
      RATE_LIMIT_READ: "3",
      RATE_LIMIT_REACT: "2",
    })
    limited = createApp(config, openDb(path.join(dir, "mimema.sqlite"))).app
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const verify = (ip: string) =>
    limited.request("/api/verify-key", {
      method: "POST",
      headers: { "x-meme-key": KEY, "cf-connecting-ip": ip },
    })

  it("429s the key oracle past the cap, per IP", async () => {
    expect((await verify("203.0.113.7")).status).toBe(204)
    expect((await verify("203.0.113.7")).status).toBe(204)
    const blocked = await verify("203.0.113.7")
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("retry-after")).toBeTruthy()
    expect((await blocked.json()) as { error: string }).toEqual({ error: "rate limit exceeded" })

    // a different client is unaffected
    expect((await verify("198.51.100.4")).status).toBe(204)
  })

  it("429s reads past the cap", async () => {
    const get = () =>
      limited.request("/api/items", { headers: { "cf-connecting-ip": "203.0.113.9" } })
    expect((await get()).status).toBe(200)
    expect((await get()).status).toBe(200)
    expect((await get()).status).toBe(200)
    expect((await get()).status).toBe(429)
  })

  it("429s reacts on their own bucket, leaving writes alone", async () => {
    const form = new FormData()
    form.set("file", new File([fakePng(200) as BlobPart], "x.png"))
    const created = (await (
      await limited.request("/api/items", {
        method: "POST",
        body: form,
        headers: { "x-meme-key": KEY, "cf-connecting-ip": "203.0.113.11" },
      })
    ).json()) as ItemDto

    const react = () =>
      limited.request(`/api/items/${created.slug}/react`, {
        method: "POST",
        body: JSON.stringify({ emoji: "🔥" }),
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.11" },
      })
    expect((await react()).status).toBe(200)
    expect((await react()).status).toBe(200)
    expect((await react()).status).toBe(429)

    // the write bucket (default 30) was untouched by those reacts
    const del = await limited.request(`/api/items/${created.slug}`, {
      method: "DELETE",
      headers: { "x-meme-key": KEY, "cf-connecting-ip": "203.0.113.11" },
    })
    expect(del.status).toBe(204)
  })
})
