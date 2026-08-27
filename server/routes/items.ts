import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { Config } from "../config.ts"
import type { Store } from "../store.ts"
import type { ItemSort } from "../../shared/schema.ts"
import { ITEM_SORTS, itemPatchSchema, parseTagField, reactionSchema, slugifyTag } from "../../shared/schema.ts"
import { requireKey } from "../auth.ts"
import { sniff } from "../sniff.ts"
import { imageSize, DIM_MAX } from "../imageSize.ts"

const IMAGE_MAX = 12 * 1024 * 1024
const VIDEO_MAX = 40 * 1024 * 1024

export function itemsRoutes(store: Store, config: Config): Hono {
  const r = new Hono()

  // ?sort=new|old|top — new/old are keyset-paged; top ranks by total reactions
  // and is deliberately single-page (a mutable count has no stable cursor).
  r.get("/", (c) => {
    const q = c.req.query("q")?.trim() || undefined
    const template = c.req.query("template") || undefined
    const tag = slugifyTag(c.req.query("tag") ?? "") || undefined
    const rawSort = c.req.query("sort") ?? "new"
    const sort: ItemSort = (ITEM_SORTS as readonly string[]).includes(rawSort)
      ? (rawSort as ItemSort)
      : "new"
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 40) || 40, 1), 100)
    let cursor: { createdAt: number; id: number } | undefined
    const rawCursor = c.req.query("cursor")
    if (rawCursor) {
      const [t, i] = rawCursor.split(".")
      const createdAt = Number(t)
      const id = Number(i)
      if (Number.isFinite(createdAt) && Number.isFinite(id)) cursor = { createdAt, id }
    }
    const { rows, hasMore } = store.listItems({ q, template, tag, sort, cursor, limit })
    const last = rows[rows.length - 1]
    return c.json({
      items: store.dtos(rows),
      nextCursor:
        sort !== "top" && hasMore && last ? `${last.created_at}.${last.id}` : null,
    })
  })

  r.post(
    "/",
    requireKey(config.inviteKey),
    bodyLimit({ maxSize: VIDEO_MAX }),
    async (c) => {
      const form = await c.req.formData()
      const file = form.get("file")
      if (!(file instanceof File)) return c.json({ error: "missing file" }, 400)

      // size gates before arrayBuffer() where we can — buffering 40 MB only to
      // reject it at the 12 MB image cap is free memory for an attacker
      if (file.size > VIDEO_MAX) return c.json({ error: "file too large" }, 413)

      const data = Buffer.from(await file.arrayBuffer())
      const sniffed = sniff(data)
      if (!sniffed) return c.json({ error: "unsupported file type" }, 415)
      if (sniffed.kind === "video" && !config.allowVideo) {
        return c.json({ error: "video uploads are disabled" }, 415)
      }
      if (sniffed.kind === "image" && data.byteLength > IMAGE_MAX) {
        return c.json({ error: "image too large (12 MB max)" }, 413)
      }

      const kind = form.get("kind") === "meme" ? "meme" : "upload"
      const title = String(form.get("title") ?? "").trim().slice(0, 140)
      const templateId = form.get("templateId") ? String(form.get("templateId")) : null
      const rawTags = form.get("tags")
      const tags = parseTagField(typeof rawTags === "string" ? rawTags : null)
      const dims =
        sniffed.kind === "image" ? imageSize(data, sniffed.ext) : null
      if (dims && (dims.width > DIM_MAX || dims.height > DIM_MAX)) {
        return c.json({ error: `image dimensions exceed ${DIM_MAX}px` }, 422)
      }

      const row = store.createItem({
        kind,
        title,
        templateId,
        mime: sniffed.mime,
        ext: sniffed.ext,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        tags,
        data,
      })
      // a dedup hit created nothing — say so instead of faking a 201
      if (row.deduped) return c.json({ ...store.dto(row), deduped: true }, 200)
      return c.json(store.dto(row), 201)
    },
  )

  r.get("/:slug", (c) => {
    const row = store.itemBySlug(c.req.param("slug") ?? "")
    if (!row) return c.json({ error: "not found" }, 404)
    return c.json(store.dto(row))
  })

  r.patch("/:slug", requireKey(config.inviteKey), async (c) => {
    const slug = c.req.param("slug") ?? ""
    if (!store.itemBySlug(slug)) return c.json({ error: "not found" }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "expected a JSON body" }, 400)
    }
    const parsed = itemPatchSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid patch" }, 422)
    const row = store.updateItem(slug, parsed.data)
    if (!row) return c.json({ error: "not found" }, 404)
    return c.json(store.dto(row))
  })

  // public on purpose — reacting is the cheapest way to join in. The react
  // rate-limit bucket (see app.ts) is what keeps it honest.
  r.post("/:slug/react", async (c) => {
    const row = store.itemBySlug(c.req.param("slug") ?? "")
    if (!row) return c.json({ error: "not found" }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "expected a JSON body" }, 400)
    }
    const parsed = reactionSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "unknown reaction" }, 422)
    const count = store.react(row.id, parsed.data.emoji)
    return c.json({ emoji: parsed.data.emoji, count, reactions: store.reactionsOf(row.id) })
  })

  r.delete("/:slug", requireKey(config.inviteKey), (c) => {
    if (!store.deleteItem(c.req.param("slug") ?? "")) return c.json({ error: "not found" }, 404)
    return c.body(null, 204)
  })

  return r
}

export function tagsRoutes(store: Store): Hono {
  const r = new Hono()
  r.get("/", (c) => c.json(store.tagCounts(100)))
  return r
}
