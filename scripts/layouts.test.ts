import { describe, expect, it } from "vitest"
import { GENERIC_PLACEHOLDER, loadLayouts, parseLayout } from "./layouts.ts"
import { ZONES_MAX } from "../shared/schema.ts"

// The layouts are hand-placed JSON, and every mistake in them is quiet: a
// misspelled id applies to nothing, a "TOP TEXT" placeholder tells the /meme
// skill nothing, two zones called the same thing make the captions ambiguous.
// These guard the shape of the files, not the taste of the boxes inside them —
// only an eye on the rendered PNG can judge that.

const { layouts, errors } = loadLayouts()

/** A zone with everything the schema needs, so a fixture can vary one thing. */
const zone = (placeholder: string) => ({ x: 0.1, y: 0.1, w: 0.5, h: 0.3, placeholder })

describe("curated template layouts", () => {
  it("parses every file in scripts/layouts/", () => {
    // an empty directory is a valid state — this is what the first curator sees
    expect(errors.map((e) => `${e.file}: ${e.reason}`)).toEqual([])
  })

  it("names a template per file and never the same one twice", () => {
    const seen = new Set<string>()
    for (const layout of layouts) {
      expect(seen.has(layout.id), `${layout.id} appears twice`).toBe(false)
      seen.add(layout.id)
    }
  })

  it("keeps every zone inside the picture", () => {
    for (const layout of layouts) {
      expect(layout.zones.length, layout.id).toBeGreaterThan(0)
      expect(layout.zones.length, layout.id).toBeLessThanOrEqual(ZONES_MAX)
      for (const [i, z] of layout.zones.entries()) {
        expect(z.x + z.w, `${layout.id} zone ${i} runs off the right edge`).toBeLessThanOrEqual(1)
        expect(z.y + z.h, `${layout.id} zone ${i} runs off the bottom edge`).toBeLessThanOrEqual(1)
      }
    }
  })

  it("gives every zone a placeholder that says what it means", () => {
    for (const layout of layouts) {
      const placeholders = layout.zones.map((z) => (z.placeholder ?? "").trim())
      for (const [i, p] of placeholders.entries()) {
        expect(GENERIC_PLACEHOLDER.test(p), `${layout.id} zone ${i}: "${p}"`).toBe(false)
      }
      const lowered = placeholders.map((p) => p.toLowerCase())
      expect(new Set(lowered).size, `${layout.id} reuses a placeholder`).toBe(lowered.length)
    }
  })
})

describe("the layout loader", () => {
  it("accepts a minimal layout and fills the style defaults", () => {
    const layout = parseLayout({ id: "x", zones: [zone("REJECTED THING")] }, "x")
    expect(layout.zones[0]?.style.fontFamily).toBe("Anton")
    expect(layout.zones[0]?.align).toBe("center")
  })

  it("refuses a file whose id doesn't match its name", () => {
    expect(() => parseLayout({ id: "drake", zones: [zone("A THING")] }, "drake-hotline-bling"))
      .toThrow(/doesn't match the filename/)
  })

  it("refuses a generic placeholder", () => {
    expect(() => parseLayout({ id: "x", zones: [zone("TOP TEXT")] }, "x")).toThrow(/generic/)
    expect(() => parseLayout({ id: "x", zones: [zone("Text 2")] }, "x")).toThrow(/generic/)
  })

  it("refuses a missing placeholder", () => {
    expect(() => parseLayout({ id: "x", zones: [{ x: 0, y: 0, w: 1, h: 0.2 }] }, "x")).toThrow(
      /generic/,
    )
  })

  it("refuses two zones that mean the same thing", () => {
    expect(() =>
      parseLayout({ id: "x", zones: [zone("SAME"), { ...zone("same"), y: 0.6 }] }, "x"),
    ).toThrow(/used twice/)
  })

  it("refuses zones the schema won't take", () => {
    expect(() => parseLayout({ id: "x", zones: [] }, "x")).toThrow()
    expect(() => parseLayout({ id: "x", zones: [{ ...zone("A"), x: 1.4 }] }, "x")).toThrow()
  })

  it("reads a directory that isn't there as empty", () => {
    expect(loadLayouts("/nonexistent/mimema/layouts")).toEqual({ layouts: [], errors: [] })
  })
})
