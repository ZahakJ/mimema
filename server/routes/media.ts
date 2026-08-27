import { Hono } from "hono"
import fs from "node:fs"
import { Readable } from "node:stream"
import type { Store } from "../store.ts"
import type { Config } from "../config.ts"
import { renderSharePage } from "../share.ts"

// /m/<slug>        → HTML share page (OG tags)
// /m/<slug>.<ext>  → raw bytes, Range-capable, immutable
// /t/<id>.<ext>    → template images, immutable

export function mediaRoutes(store: Store, config: Config): Hono {
  const r = new Hono()

  r.get("/m/:name", (c) => {
    const name = c.req.param("name")
    const dot = name.lastIndexOf(".")
    if (dot === -1) {
      const row = store.itemBySlug(name)
      if (!row) return c.text("not found", 404)
      c.header("Cache-Control", "no-cache")
      return c.html(renderSharePage(store.dto(row), config.publicOrigin))
    }
    const slug = name.slice(0, dot)
    const ext = name.slice(dot + 1)
    const row = store.itemBySlug(slug)
    if (!row || row.ext !== ext) return c.text("not found", 404)
    return serveFile(c.req.header("range"), store.mediaPath(row.slug, row.ext), row.mime)
  })

  r.get("/t/:file", (c) => {
    const file = c.req.param("file")
    const dot = file.lastIndexOf(".")
    if (dot === -1) return c.text("not found", 404)
    const row = store.templateById(file.slice(0, dot))
    if (!row || row.ext !== file.slice(dot + 1)) return c.text("not found", 404)
    const mime = row.ext === "jpg" ? "image/jpeg" : `image/${row.ext}`
    return serveFile(c.req.header("range"), store.templatePath(row.id, row.ext), mime)
  })

  return r
}

function serveFile(range: string | undefined, filePath: string, mime: string): Response {
  let size: number
  try {
    size = fs.statSync(filePath).size
  } catch {
    return new Response("gone", { status: 404 })
  }

  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    // slugs are immutable — a new upload gets a new slug
    "Cache-Control": "public, max-age=31536000, immutable",
  }

  const m = range?.match(/^bytes=(\d*)-(\d*)$/)
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (!m[1] && m[2]) end = size - 1
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } })
    }
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`
    headers["Content-Length"] = String(end - start + 1)
    const stream = Readable.toWeb(
      fs.createReadStream(filePath, { start, end }),
    ) as ReadableStream
    return new Response(stream, { status: 206, headers })
  }

  headers["Content-Length"] = String(size)
  const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream
  return new Response(stream, { status: 200, headers })
}
