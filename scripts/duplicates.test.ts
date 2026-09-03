import { describe, expect, it } from "vitest"
import { DUPLICATE_ALIASES, DUPLICATE_GROUPS } from "./duplicates.ts"
import { slugifyName } from "../server/slugs.ts"

// The duplicate list is hand-written, and a typo in it is silent: a misspelled
// id simply never matches anything, so the duplicate it was meant to catch
// sails back into the pack on the next `npm run templates`. These guard the
// shape of the list, not the judgement calls inside it.

const ids = DUPLICATE_GROUPS.flatMap((g) => [g.keep, ...g.drop])

describe("duplicate template groups", () => {
  it("uses ids the importer would actually produce", () => {
    // fetch-templates derives the id with slugifyName, so an id that isn't
    // already slug-shaped can never match a candidate
    for (const id of ids) expect(slugifyName(id), id).toBe(id)
  })

  it("never drops a template another group keeps", () => {
    const kept = new Set(DUPLICATE_GROUPS.map((g) => g.keep))
    for (const group of DUPLICATE_GROUPS) {
      for (const drop of group.drop) {
        expect(kept.has(drop), `${drop} is both kept and dropped`).toBe(false)
      }
    }
  })

  it("names each duplicate exactly once", () => {
    const seen = new Set<string>()
    for (const group of DUPLICATE_GROUPS) {
      for (const drop of group.drop) {
        expect(seen.has(drop), `${drop} listed twice`).toBe(false)
        seen.add(drop)
      }
    }
  })

  it("keeps one survivor per group", () => {
    const keepers = DUPLICATE_GROUPS.map((g) => g.keep)
    expect(new Set(keepers).size).toBe(keepers.length)
  })

  it("says what it drops and why", () => {
    for (const group of DUPLICATE_GROUPS) {
      expect(group.drop.length, group.keep).toBeGreaterThan(0)
      expect(group.note.length, group.keep).toBeGreaterThan(0)
    }
  })

  it("maps every dropped id to its survivor", () => {
    expect(DUPLICATE_ALIASES.size).toBe(DUPLICATE_GROUPS.reduce((n, g) => n + g.drop.length, 0))
    for (const group of DUPLICATE_GROUPS) {
      for (const drop of group.drop) expect(DUPLICATE_ALIASES.get(drop)).toBe(group.keep)
    }
  })
})
