// Loads the curated per-template zone layouts in scripts/layouts/.
//
// The pack importer only knows how many caption boxes a template has, so it
// hands every one of them the same evenly-stacked full-width bands
// (defaultZones() in shared/schema.ts). That is wrong for almost every meme:
// Drake's two captions belong in the right-hand column, Distracted Boyfriend's
// three labels belong on the three people. The right boxes can only be placed
// by looking at the picture, so they are placed once, by hand, and kept in the
// repo as one JSON file per template.
//
// This module is the single reader of that directory — apply-layouts.ts writes
// what it returns into the DB, layouts.test.ts holds it to the same rules — so
// a layout that the test accepts is a layout the apply script can apply.
//
// A placeholder is not decoration: it is the zone's *meaning*, and it is the
// only thing the /meme skill (.claude/skills/meme/SKILL.md) and a human in the
// forge have to tell "REJECTED THING" from "APPROVED THING". "TOP TEXT" says
// nothing, so it is refused here.
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { ZONES_MAX, zonesSchema } from "../shared/schema.ts"
import type { Zone } from "../shared/schema.ts"

export const LAYOUTS_DIR = path.join(import.meta.dirname, "layouts")

/** Placeholders the importer invents. Kept byte-identical to the regex the
 *  /meme skill filters its catalog with — if one changes, change both. */
export const GENERIC_PLACEHOLDER = /^(TOP TEXT|BOTTOM TEXT|TEXT( \d+)?)?$/i

export type Layout = {
  /** template id — must equal the file's basename */
  id: string
  zones: Zone[]
}

/** A layout file that can't be applied, and the one-line reason why. */
export type LayoutError = { file: string; reason: string }

const layoutFileSchema = z.object({
  id: z.string().min(1),
  zones: zonesSchema,
})

/** Parse one layout file's JSON. `id` is the expected id (the basename), so a
 *  file renamed without editing its `id` is caught rather than silently
 *  retargeted. Throws with a pointed message; never returns a half-valid one. */
export function parseLayout(raw: unknown, expectedId: string): Layout {
  const parsed = layoutFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "not a valid layout",
    )
  }
  const { id, zones } = parsed.data
  if (id !== expectedId) throw new Error(`id "${id}" doesn't match the filename "${expectedId}"`)
  // zonesSchema already caps at ZONES_MAX; say the number out loud anyway so
  // the ceiling is visible where a curator reads the error.
  if (zones.length > ZONES_MAX) throw new Error(`${zones.length} zones — the ceiling is ${ZONES_MAX}`)

  const seen = new Set<string>()
  zones.forEach((zone, i) => {
    const placeholder = (zone.placeholder ?? "").trim()
    if (GENERIC_PLACEHOLDER.test(placeholder)) {
      throw new Error(
        `zone ${i} has the generic placeholder ${placeholder ? `"${placeholder}"` : "(empty)"} — ` +
          `say what the box means ("REJECTED THING", "WHAT I EXPECTED")`,
      )
    }
    const key = placeholder.toLowerCase()
    if (seen.has(key)) throw new Error(`zone ${i}: placeholder "${placeholder}" is used twice`)
    seen.add(key)
  })

  return { id, zones }
}

/** Every `<id>.json` in the directory, sorted by id. Bad files are collected,
 *  not thrown — the caller reports all of them at once. A missing directory
 *  reads as empty. */
export function loadLayouts(dir: string = LAYOUTS_DIR): {
  layouts: Layout[]
  errors: LayoutError[]
} {
  const layouts: Layout[] = []
  const errors: LayoutError[] = []
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return { layouts, errors }
  }

  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const file = path.join(dir, name)
    try {
      layouts.push(parseLayout(JSON.parse(fs.readFileSync(file, "utf8")), name.slice(0, -5)))
    } catch (err) {
      errors.push({ file: name, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { layouts, errors }
}
