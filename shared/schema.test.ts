import { describe, expect, it } from "vitest"
import {
  zoneSchema,
  zonesSchema,
  templateMetaSchema,
  DEFAULT_ZONE_STYLE,
  itemPatchSchema,
  normalizeTags,
  parseTagField,
  reactionSchema,
  slugifyTag,
  TAG_MAX_LEN,
} from "./schema.ts"

describe("zone schema", () => {
  it("fills defaults from a bare rect", () => {
    const z = zoneSchema.parse({ x: 0.1, y: 0.1, w: 0.8, h: 0.2 })
    expect(z.align).toBe("center")
    expect(z.valign).toBe("middle")
    expect(z.angle).toBe(0)
    expect(z.style).toEqual(DEFAULT_ZONE_STYLE)
  })
  it("round-trips through JSON", () => {
    const z = zoneSchema.parse({ x: 0, y: 0.7, w: 1, h: 0.3, style: { fontFrac: 0.2 } })
    expect(zoneSchema.parse(JSON.parse(JSON.stringify(z)))).toEqual(z)
  })
  it("rejects out-of-range rects", () => {
    expect(zoneSchema.safeParse({ x: 1.2, y: 0, w: 0.5, h: 0.5 }).success).toBe(false)
    expect(zoneSchema.safeParse({ x: 0, y: 0, w: 0, h: 0.5 }).success).toBe(false)
  })
  it("bounds zone count", () => {
    expect(zonesSchema.safeParse([]).success).toBe(false)
  })
  it("validates template meta", () => {
    const meta = templateMetaSchema.parse({
      name: "Wait What",
      zones: [{ x: 0, y: 0, w: 1, h: 0.25 }],
    })
    expect(meta.name).toBe("Wait What")
  })
})

describe("tags", () => {
  it("slugifies leniently", () => {
    expect(slugifyTag("  Deep Fried  ")).toBe("deep-fried")
    expect(slugifyTag("CURSED!!!")).toBe("cursed")
    expect(slugifyTag("a — b")).toBe("a-b")
    expect(slugifyTag("💀💀💀")).toBe("")
    expect(slugifyTag("x".repeat(40)).length).toBe(TAG_MAX_LEN)
  })
  it("de-duplicates, drops empties, caps at eight", () => {
    expect(normalizeTags(["Dank", "dank", "!!!", " cursed "])).toEqual(["dank", "cursed"])
    expect(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length).toBe(8)
  })
  it("parses both wire forms of the multipart field", () => {
    expect(parseTagField("dank, cursed ,dank")).toEqual(["dank", "cursed"])
    expect(parseTagField('["dank","Cursed"]')).toEqual(["dank", "cursed"])
    expect(parseTagField(null)).toEqual([])
    expect(parseTagField("[not json")).toEqual(["not-json"])
  })
  it("validates a patch body", () => {
    expect(itemPatchSchema.parse({ tags: ["A B"] })).toEqual({ tags: ["a-b"] })
    expect(itemPatchSchema.safeParse({}).success).toBe(false)
    expect(itemPatchSchema.safeParse({ tags: Array(100).fill("x") }).success).toBe(false)
  })
})

describe("reactions", () => {
  it("accepts only the fixed set", () => {
    expect(reactionSchema.safeParse({ emoji: "🔥" }).success).toBe(true)
    expect(reactionSchema.safeParse({ emoji: "🍕" }).success).toBe(false)
  })
})
