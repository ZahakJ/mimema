import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { Config } from "../config.ts"
import type { Store } from "../store.ts"
import { templateDto } from "../store.ts"
import { requireKey } from "../auth.ts"
import { sniff } from "../sniff.ts"
import { imageSize, DIM_MAX } from "../imageSize.ts"
import { slugifyName } from "../slugs.ts"
import { templateMetaSchema } from "../../shared/schema.ts"

export function templatesRoutes(store: Store, config: Config): Hono {
  const r = new Hono()

  r.get("/", (c) => c.json(store.listTemplates().map(templateDto)))

  r.get("/:id", (c) => {
    const row = store.templateById(c.req.param("id"))
    if (!row) return c.json({ error: "not found" }, 404)
    return c.json(templateDto(row))
  })

  r.post(
    "/",
    requireKey(config.inviteKey),
    bodyLimit({ maxSize: 12 * 1024 * 1024 }),
    async (c) => {
      const form = await c.req.formData()
      const image = form.get("image")
      if (!(image instanceof File)) return c.json({ error: "missing image" }, 400)

      let meta
      try {
        meta = templateMetaSchema.parse(JSON.parse(String(form.get("meta") ?? "")))
      } catch {
        return c.json({ error: "invalid template meta" }, 400)
      }

      const data = Buffer.from(await image.arrayBuffer())
      const sniffed = sniff(data)
      if (!sniffed || sniffed.kind !== "image") {
        return c.json({ error: "template must be an image" }, 415)
      }
      const dims = imageSize(data, sniffed.ext)
      if (!dims) return c.json({ error: "could not read image dimensions" }, 415)
      if (dims.width > DIM_MAX || dims.height > DIM_MAX) {
        return c.json({ error: `image dimensions exceed ${DIM_MAX}px` }, 422)
      }

      const id = slugifyName(meta.name) || "template"
      const row = store.createTemplate({
        id,
        name: meta.name,
        source: "custom",
        ext: sniffed.ext,
        width: dims.width,
        height: dims.height,
        zones: meta.zones,
        data,
      })
      return c.json(templateDto(row), 201)
    },
  )

  r.delete("/:id", requireKey(config.inviteKey), (c) => {
    if (!store.deleteTemplate(c.req.param("id") ?? "")) return c.json({ error: "not found" }, 404)
    return c.body(null, 204)
  })

  return r
}
