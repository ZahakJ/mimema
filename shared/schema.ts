import { z } from "zod"

// Zones and layers share one fractional coordinate system: x/y/w/h are
// fractions of the template image's dimensions, 0..1. The same math renders
// template presets, editor layers, and the zone editor's rects.

export const MEME_FONTS = ["Anton", "Bangers", "Oswald", "Inter", "JetBrains Mono"] as const
export type MemeFont = (typeof MEME_FONTS)[number]

/** Drop shadow behind the glyphs. All three distances are fractions of the
 *  document height, so one number renders the same at preview scale and at
 *  native export resolution. Optional: docs saved before shadows still parse. */
export const textShadowSchema = z.object({
  blur: z.number().min(0).max(0.05).default(0.012),
  dx: z.number().min(-0.05).max(0.05).default(0.006),
  dy: z.number().min(-0.05).max(0.05).default(0.008),
  color: z.string().default("#000000"),
})
export type TextShadow = z.infer<typeof textShadowSchema>

export const DEFAULT_TEXT_SHADOW: TextShadow = textShadowSchema.parse({})

export const zoneStyleSchema = z.object({
  fontFamily: z.enum(MEME_FONTS).default("Anton"),
  /** font size as a fraction of image height; shrink-to-fit floor is 0.025 */
  fontFrac: z.number().min(0.02).max(0.5).default(0.1),
  fill: z.string().default("#ffffff"),
  stroke: z.string().default("#000000"),
  /** stroke width as a fraction of font size */
  strokeFrac: z.number().min(0).max(0.3).default(0.08),
  allCaps: z.boolean().default(true),
  /** absent = no shadow */
  shadow: textShadowSchema.optional(),
})
export type ZoneStyle = z.infer<typeof zoneStyleSchema>

export const DEFAULT_ZONE_STYLE: ZoneStyle = zoneStyleSchema.parse({})

export const zoneSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.01).max(1),
  h: z.number().min(0.01).max(1),
  align: z.enum(["left", "center", "right"]).default("center"),
  valign: z.enum(["top", "middle", "bottom"]).default("middle"),
  /** degrees, clockwise, about the zone center */
  angle: z.number().min(-180).max(180).default(0),
  style: zoneStyleSchema.default(DEFAULT_ZONE_STYLE),
  placeholder: z.string().optional(),
})
export type Zone = z.infer<typeof zoneSchema>

/** hard ceiling on zones per template — the zone editor guards the same number */
export const ZONES_MAX = 24

export const zonesSchema = z.array(zoneSchema).min(1).max(ZONES_MAX)

export const templateMetaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  zones: zonesSchema,
})
export type TemplateMeta = z.infer<typeof templateMetaSchema>

/** Where a template came from. Append-only: 'seed' predates the pack importer
 *  and old rows must stay valid, so nothing is ever removed from this list. */
export const TEMPLATE_SOURCES = ["imgflip", "memegen", "custom", "seed"] as const
export const templateSourceSchema = z.enum(TEMPLATE_SOURCES)
export type TemplateSource = (typeof TEMPLATE_SOURCES)[number]

/** Human-facing label for the attribution line ("via imgflip ↗"). */
export const SOURCE_LABEL: Record<TemplateSource, string> = {
  imgflip: "imgflip",
  memegen: "memegen",
  custom: "you",
  seed: "seed",
}

// ————— tags —————

export const TAG_MAX_LEN = 24
export const TAGS_PER_ITEM = 8

/** Lenient slugify: lowercase, whitespace/underscores → dashes, everything
 *  outside [a-z0-9-] dropped. Never throws — junk in yields "" out. */
export function slugifyTag(raw: string): string {
  return raw
    .toLowerCase()
    .replaceAll(/[\s_]+/g, "-")
    .replaceAll(/[^a-z0-9-]/g, "")
    .replaceAll(/-{2,}/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, TAG_MAX_LEN)
    .replaceAll(/-+$/g, "")
}

/** Slugify, drop empties, de-duplicate, cap at TAGS_PER_ITEM. Extras are
 *  dropped rather than rejected — the merge-on-dedup path has to cap anyway,
 *  so one rule holds everywhere. */
export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = []
  for (const candidate of raw) {
    const tag = slugifyTag(candidate)
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length === TAGS_PER_ITEM) break
  }
  return out
}

/** Wire form of the multipart `tags` field: comma-separated ("dank,cursed").
 *  A JSON array is also accepted so one encoder serves multipart and JSON. */
export function parseTagField(raw: string | readonly string[] | null | undefined): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return normalizeTags(raw as readonly string[])
  const text = String(raw).trim()
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) return normalizeTags(parsed.map((v) => String(v)))
    } catch {
      /* not JSON after all — fall through to comma-separated */
    }
  }
  return normalizeTags(text.split(","))
}

/** raw strings in, normalized tags out — bounded before the transform so a
 *  million-element array is rejected instead of slugified */
export const tagsSchema = z.array(z.string()).max(64).transform(normalizeTags)

export const itemPatchSchema = z
  .object({
    title: z.string().trim().max(140).optional(),
    tags: tagsSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.tags !== undefined, {
    message: "nothing to update",
  })
export type ItemPatch = z.infer<typeof itemPatchSchema>

// ————— reactions —————

/** the whole vocabulary — fixed so counts stay a bounded, cacheable set */
export const REACTION_EMOJI = ["🔥", "💀", "🗿"] as const
export type ReactionEmoji = (typeof REACTION_EMOJI)[number]

export const reactionSchema = z.object({ emoji: z.enum(REACTION_EMOJI) })

export const ITEM_SORTS = ["new", "old", "top"] as const
export type ItemSort = (typeof ITEM_SORTS)[number]

// ————— wire DTOs (server JSON → client) —————

export type TemplateDto = {
  id: string
  name: string
  source: TemplateSource
  ext: string
  width: number
  height: number
  zones: Zone[]
  /** e.g. /t/distracted-boyfriend.jpg */
  imageUrl: string
  /** upstream page this template was imported from; null for customs */
  sourceUrl: string | null
  createdAt: number
}

export type ItemDto = {
  slug: string
  kind: "meme" | "upload"
  title: string
  templateId: string | null
  mime: string
  ext: string
  bytes: number
  width: number | null
  height: number | null
  /** raw bytes: /m/<slug>.<ext> */
  url: string
  /** OG share page: /m/<slug> */
  shareUrl: string
  createdAt: number
  tags: string[]
  /** only nonzero counts, keyed by REACTION_EMOJI members */
  reactions: Record<string, number>
  /** only on upload responses: these bytes already existed (sha256 hit), 200 not 201 */
  deduped?: boolean
}

export type ItemPage = {
  items: ItemDto[]
  /** pass back as ?cursor= for the next page; null when exhausted */
  nextCursor: string | null
}

export type TagCountDto = { tag: string; count: number }

// ————— editor document (client-side, persisted in mimema:v1:editor) —————

export const textLayerSchema = zoneSchema.extend({
  type: z.literal("text"),
  id: z.string(),
  text: z.string().default(""),
})
export type TextLayer = z.infer<typeof textLayerSchema>

export const stickerLayerSchema = z.object({
  type: z.literal("sticker"),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  angle: z.number().default(0),
  /** data: URL — stickers are session-local, baked into the export */
  src: z.string(),
})
export type StickerLayer = z.infer<typeof stickerLayerSchema>

/** Classic zone layout for templates we only know the box count of. */
export function defaultZones(boxCount: number): Zone[] {
  const band = (y: number, h: number, placeholder: string): Zone =>
    zoneSchema.parse({ x: 0.03, y, w: 0.94, h, placeholder })
  if (boxCount <= 1) return [band(0.72, 0.26, "BOTTOM TEXT")]
  if (boxCount === 2) return [band(0.02, 0.24, "TOP TEXT"), band(0.74, 0.24, "BOTTOM TEXT")]
  const n = Math.min(boxCount, 6)
  const gap = 0.02
  const h = (1 - gap * (n + 1)) / n
  return Array.from({ length: n }, (_, i) =>
    band(gap + i * (h + gap), h, `TEXT ${i + 1}`),
  )
}

export const memeDocSchema = z.object({
  templateId: z.string().nullable(),
  /** native pixel size of the base image (export resolution) */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  layers: z.array(z.discriminatedUnion("type", [textLayerSchema, stickerLayerSchema])),
  deepFry: z.boolean().default(false),
})
export type MemeDoc = z.infer<typeof memeDocSchema>
export type Layer = MemeDoc["layers"][number]
