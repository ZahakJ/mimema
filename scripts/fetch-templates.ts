// Pulls the classic template packs into the gitignored data/ dir (copyrighted
// images never enter the repo). Two upstreams, both free and unauthenticated:
//
//   imgflip  https://api.imgflip.com/get_memes      ~100 templates
//   memegen  https://api.memegen.link/templates/    ~200 templates
//
// Idempotent: a template whose slugified name is already taken is skipped, so
// re-running adds only what's new and never disturbs your customs. Individual
// failures are non-fatal; an upstream being down skips that source entirely.
// The packs overlap: ids that are the same picture under a different title are
// refused here from duplicates.ts, and `npm run templates:dedupe` prunes any
// an older run let through.
//   npm run templates
import path from "node:path"
import { loadConfig } from "../server/config.ts"
import { openDb } from "../server/db.ts"
import { Store } from "../server/store.ts"
import { sniff } from "../server/sniff.ts"
import { imageSize } from "../server/imageSize.ts"
import { slugifyName } from "../server/slugs.ts"
import { DUPLICATE_ALIASES } from "./duplicates.ts"
import { defaultZones } from "../shared/schema.ts"
import type { TemplateSource, Zone } from "../shared/schema.ts"

type ImgflipMeme = {
  id: string
  name: string
  url: string
  width: number
  height: number
  box_count: number
}

type MemegenTemplate = {
  id: string
  name: string
  lines: number
  blank: string
  source?: string | null
  _self?: string | null
}

/** One template to consider importing, normalized across upstreams. */
type Candidate = {
  name: string
  /** URL of the blank image */
  imageUrl: string
  /** upstream page, for the "via …" attribution link */
  sourceUrl: string | null
  /** upstream id */
  sourceRef: string
  zones: Zone[]
  /** dimensions the API claims, used only if the bytes won't measure */
  fallback?: { width: number; height: number }
}

type Tally = { added: number; skipped: number; backfilled: number; failed: number }

const POLITENESS_MS = 150

// Collapse a display name to a comparison key: lowercase, alphanumerics only,
// filler words dropped, word order KEPT (the two Socially * Penguins are
// distinct memes that differ only in word order).
function normalizeName(name: string): string {
  const STOP = new Set(["the", "a", "an", "of", "at", "in", "on", "to", "is", "my", "meme"])
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join("")
}

const config = loadConfig()
const db = openDb(path.join(config.dataDir, "mimema.sqlite"))
const store = new Store(db, config.dataDir)

const tallies: [string, Tally][] = [
  ["imgflip", await importSource("imgflip", imgflipCandidates)],
  ["memegen", await importSource("memegen", memegenCandidates)],
]

const summary = (t: Tally) =>
  `added ${t.added}, skipped ${t.skipped}` +
  (t.backfilled ? ` (${t.backfilled} backfilled)` : "") +
  `, failed ${t.failed}`

for (const [source, t] of tallies) console.log(`[templates] ${source}: ${summary(t)}`)
const total = tallies.reduce<Tally>(
  (acc, [, t]) => ({
    added: acc.added + t.added,
    skipped: acc.skipped + t.skipped,
    backfilled: acc.backfilled + t.backfilled,
    failed: acc.failed + t.failed,
  }),
  { added: 0, skipped: 0, backfilled: 0, failed: 0 },
)
console.log(
  `[templates] total: ${summary(total)} — ${store.listTemplates().length} templates on disk`,
)
db.close()

// ————— the shared import loop —————

async function importSource(
  source: TemplateSource,
  list: () => Promise<Candidate[]>,
): Promise<Tally> {
  const tally: Tally = { added: 0, skipped: 0, backfilled: 0, failed: 0 }
  let candidates: Candidate[]
  try {
    candidates = await list()
  } catch (err) {
    console.warn(`[templates] ${source} index: ${message(err)} — skipping this source`)
    return tally
  }

  const taken = new Set(store.listTemplates().map((t) => normalizeName(t.name)))

  for (const candidate of candidates) {
    const id = slugifyName(candidate.name)
    if (id && (DUPLICATE_ALIASES.has(id) || taken.has(normalizeName(candidate.name)))) {
      // Same meme under a slightly different name than one we already hold
      // ("Woman Yelling At Cat" vs "Woman Yelling At A Cat") — skip it.
      if (!store.templateById(id)) {
        tally.skipped++
        continue
      }
    }
    // The id IS the primary dedup key: a name that already resolves to a
    // template — from the other pack, an earlier run, or one of your own — is
    // left alone.
    const existing = id ? store.templateById(id) : undefined
    if (!id || existing) {
      // …except that rows imported before v3 have no attribution. If this row
      // came from this very source, hand it its missing credit. Free: no fetch.
      if (
        existing &&
        existing.source === source &&
        existing.source_url === null &&
        candidate.sourceUrl &&
        store.backfillTemplateSource(id, candidate.sourceUrl, candidate.sourceRef)
      ) {
        tally.backfilled++
      }
      tally.skipped++
      continue
    }
    try {
      const data = await download(candidate.imageUrl)
      const sniffed = sniff(data)
      if (!sniffed || sniffed.kind !== "image") throw new Error("not a sniffable image")
      const dims = imageSize(data, sniffed.ext) ?? candidate.fallback
      if (!dims) throw new Error("could not read image dimensions")
      taken.add(normalizeName(candidate.name))
      store.createTemplate({
        id,
        name: candidate.name,
        source,
        ext: sniffed.ext,
        width: dims.width,
        height: dims.height,
        zones: candidate.zones,
        data: Buffer.from(data),
        sourceUrl: candidate.sourceUrl,
        sourceRef: candidate.sourceRef,
      })
      tally.added++
    } catch (err) {
      tally.failed++
      console.warn(`[templates] ${source}/${id}: ${message(err)}`)
    } finally {
      // politeness — owed on failures too, since a failed try still cost the
      // upstream up to three requests
      await sleep(POLITENESS_MS)
    }
  }
  return tally
}

// ————— upstream adapters —————

async function imgflipCandidates(): Promise<Candidate[]> {
  const body = (await getJson("https://api.imgflip.com/get_memes")) as {
    success?: boolean
    data?: { memes?: ImgflipMeme[] }
  }
  if (!body.success || !body.data?.memes) throw new Error("API reported failure")
  return body.data.memes.map((meme) => ({
    name: meme.name,
    imageUrl: meme.url,
    // /memetemplate/<id> redirects to the pretty named page
    sourceUrl: `https://imgflip.com/memetemplate/${encodeURIComponent(meme.id)}`,
    sourceRef: meme.id,
    zones: defaultZones(meme.box_count),
    fallback: { width: meme.width, height: meme.height },
  }))
}

async function memegenCandidates(): Promise<Candidate[]> {
  const body = (await getJson("https://api.memegen.link/templates/")) as MemegenTemplate[]
  if (!Array.isArray(body)) throw new Error("expected a JSON array of templates")
  return body
    .filter((t) => t.blank && t.name)
    .map((t) => ({
      name: t.name,
      imageUrl: t.blank,
      // `source` is the meme's origin story (knowyourmeme &c); `_self` is the
      // API record. Prefer the human page, fall back to the record.
      sourceUrl: t.source || t._self || `https://api.memegen.link/templates/${t.id}`,
      sourceRef: t.id,
      zones: defaultZones(t.lines),
    }))
}

// ————— plumbing —————

async function getJson(url: string, tries = 3): Promise<unknown> {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    } catch (err) {
      if (i >= tries) throw err
      await sleep(400 * i)
    }
  }
}

async function download(url: string, tries = 3): Promise<Uint8Array> {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return new Uint8Array(await r.arrayBuffer())
    } catch (err) {
      if (i >= tries) throw err
      await sleep(400 * i)
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
