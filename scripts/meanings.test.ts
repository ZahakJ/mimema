import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  JOKE_SHAPES,
  MAX_SAYS_CHARS,
  MEANINGS_PATH,
  loadMeanings,
  parseMeanings,
  shapesFor,
} from "./meanings.ts"
import { LAYOUTS_DIR } from "./layouts.ts"

// meanings.json is prose about pictures, so no test can tell a right line from
// a wrong one — only an eye on the template can. What these guard is the shape
// of the file and the two quiet failures: a meaning nobody can read because it
// is three sentences long, and a shape vocabulary that drifts away from the one
// the skill and the relay agree on.

const meanings = loadMeanings()

describe("curated template meanings", () => {
  it("parses the file in the repo", () => {
    expect(Object.keys(meanings).length).toBeGreaterThan(0)
  })

  it("keeps every line short enough to sit on a catalog row", () => {
    for (const [id, m] of Object.entries(meanings)) {
      expect(m.says.length, `${id}: ${m.says.length} chars`).toBeLessThanOrEqual(MAX_SAYS_CHARS)
      expect(m.says.includes("\n"), `${id} spans lines`).toBe(false)
      expect(m.says.trim(), id).toBe(m.says)
    }
  })

  it("gives every template at least one shape from the shared vocabulary", () => {
    for (const [id, m] of Object.entries(meanings)) {
      expect(m.shapes.length, id).toBeGreaterThan(0)
      for (const s of m.shapes) expect(JOKE_SHAPES, `${id}: ${s}`).toContain(s)
      expect(new Set(m.shapes).size, `${id} repeats a shape`).toBe(m.shapes.length)
    }
  })

  it("covers every shape, so no shape is a dead end for the picker", () => {
    const covered = new Set(Object.values(meanings).flatMap((m) => m.shapes))
    for (const shape of JOKE_SHAPES) expect([...covered], shape).toContain(shape)
  })

  it("agrees with the curated layouts about which ids exist", () => {
    // Not every meaning has a layout (a meaning is cheap, placing boxes by eye
    // is not), but an id with a layout file is an id we know is real — so any
    // meaning whose id *looks* like one of those must match it exactly. This
    // catches a typo'd slug in the common case without needing the live API.
    const layoutIds = new Set(
      fs
        .readdirSync(LAYOUTS_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.basename(f, ".json")),
    )
    const near = (id: string) => [...layoutIds].some((l) => l !== id && l.replace(/-/g, "") === id.replace(/-/g, ""))
    for (const id of Object.keys(meanings)) {
      expect(near(id), `${id} differs from a layout id only by hyphens`).toBe(false)
    }
  })

  it("refuses a meaning with an unknown shape", () => {
    expect(() => parseMeanings({ "this-is-fine": { says: "a dog in a fire", shapes: ["vibes"] } })).toThrow()
  })

  it("refuses a meaning with no shapes at all", () => {
    expect(() => parseMeanings({ "this-is-fine": { says: "a dog in a fire", shapes: [] } })).toThrow()
  })

  it("refuses an id that is not a slug", () => {
    expect(() => parseMeanings({ "This Is Fine": { says: "a dog in a fire", shapes: ["denial"] } })).toThrow()
  })

  it("looks a template's shapes up, and says so when there are none", () => {
    expect(shapesFor("this-is-fine")).toContain("denial")
    expect(shapesFor("no-such-template-at-all")).toBeNull()
  })

  it("is valid JSON on disk, not just in the loader's cache", () => {
    expect(() => JSON.parse(fs.readFileSync(MEANINGS_PATH, "utf8"))).not.toThrow()
  })
})
