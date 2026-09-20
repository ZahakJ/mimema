// What each famous template *says* — the curated half of the catalog.
//
// The API's catalog line gives a picker an id, a zone count, a name and (for
// the templates with a layout in scripts/layouts/) the zones' roles. None of
// that says what the picture means. A model reading "It's Happening  2z" has
// nothing to go on but the words in the name, so it picks by the words in the
// name — which is how a 54-year-old blood-group ratification ended up under Ron
// Paul throwing his arms in the air with no joke attached.
//
// So: one hand-written line per recognisable template saying what the picture
// asserts, plus the joke SHAPES it can carry. The /meme-news skill joins this
// onto the live catalog (an id here that no longer exists in the catalog simply
// never prints, so a stale entry is harmless), and relay/digest.ts uses the
// shapes to refuse a pick whose stated joke shape the template cannot hold.
//
// Deliberately partial. ~85 of ~270 templates, the ones a room recognises on
// sight; the rest keep the name-and-roles line they always had. A meaning you
// are not sure of is worse than no meaning — leave it out.
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

export const MEANINGS_PATH = path.join(import.meta.dirname, "meanings.json")

/**
 * The joke shapes a news story can have. A pick must name one before it names
 * a template — see .claude/skills/meme-news/SKILL.md Step 5. Small on purpose:
 * eight buckets you can tell apart, not a taxonomy.
 */
export const JOKE_SHAPES = [
  /** the thing is undone by its own premise */
  "irony",
  /** then vs now, promised vs shipped, A vs B */
  "contrast",
  /** everyone saw this coming and it arrived on schedule */
  "predictable",
  /** the response is wildly out of scale with the cause */
  "overreaction",
  /** two things presented as different are the same thing */
  "same-thing",
  /** it keeps getting bigger or stupider, step by step */
  "escalation",
  /** carrying on as if the obvious disaster is not happening */
  "denial",
  /** the take repeated back at the person who made it */
  "mockery",
] as const
export type JokeShape = (typeof JOKE_SHAPES)[number]

export type Meaning = {
  /** one line, lowercase, present tense: what the picture asserts */
  says: string
  /** the shapes this picture can carry; a story of another shape does not fit it */
  shapes: JokeShape[]
}

/** kept short so the joined catalog line still fits on one screen row */
export const MAX_SAYS_CHARS = 140

const meaningSchema = z.object({
  says: z.string().min(1).max(MAX_SAYS_CHARS),
  shapes: z.array(z.enum(JOKE_SHAPES)).min(1),
})

export const meaningsFileSchema = z.record(
  z.string().regex(/^[a-z0-9-]+$/, "a template id is a lowercase slug"),
  meaningSchema,
)

export function parseMeanings(raw: unknown): Record<string, Meaning> {
  const parsed = meaningsFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "not a valid meanings file",
    )
  }
  return parsed.data
}

let cached: Record<string, Meaning> | null = null

/** Read once per process — the relay vets every pick against it. */
export function loadMeanings(): Record<string, Meaning> {
  if (cached === null) cached = parseMeanings(JSON.parse(fs.readFileSync(MEANINGS_PATH, "utf8")))
  return cached
}

/** The curated shapes for a template, or null when it has no curated meaning. */
export function shapesFor(templateId: string): JokeShape[] | null {
  return loadMeanings()[templateId]?.shapes ?? null
}
