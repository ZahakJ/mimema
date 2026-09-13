// Writes the curated zone layouts in scripts/layouts/ into the templates table.
//
// The pack importer can only guess at caption boxes — it knows the box count
// and nothing else, so every template arrives with the same evenly-stacked
// full-width bands. The layouts are the hand-placed truth; this command is how
// they reach the DB.
//
//   npm run templates:layouts -- --dry-run          # say what would change
//   npm run templates:layouts                       # do it
//   npm run templates:layouts -- --only drake-hotline-bling,bell-curve
//
// Idempotent: a template whose stored zones already equal the layout is left
// alone, so re-running is free and a run reports exactly what moved. Safe next
// to `npm run templates`, which is insert-only for zones and so can never hand
// a curated template its bands back.
//
// A layout naming a template this data dir doesn't hold is reported as
// missing-in-db, not an error: templates:dedupe prunes duplicates, and a
// layout written against the pruned half of a pair simply has nothing to do.
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { loadConfig } from "../server/config.ts"
import { openDb } from "../server/db.ts"
import { Store } from "../server/store.ts"
import { zonesSchema } from "../shared/schema.ts"
import { LAYOUTS_DIR, loadLayouts } from "./layouts.ts"

const argv = process.argv.slice(2)
const dryRun = argv.includes("--dry-run")
const onlyArg = argv[argv.indexOf("--only") + 1]
const only =
  argv.includes("--only") && onlyArg && !onlyArg.startsWith("--")
    ? new Set(onlyArg.split(",").map((s) => s.trim()).filter(Boolean))
    : null

if (argv.includes("--only") && !only) {
  console.error("[layouts] --only needs a comma-separated list of template ids")
  process.exit(2)
}

const { layouts, errors } = loadLayouts()

// A malformed layout is a typo in something nobody re-reads — fail loudly and
// change nothing, rather than apply the other 200 and bury the message.
if (errors.length) {
  for (const e of errors) console.error(`[layouts] ${e.file}: ${e.reason}`)
  console.error(
    `[layouts] ${errors.length} invalid layout file${errors.length === 1 ? "" : "s"} in ` +
      `${path.relative(process.cwd(), LAYOUTS_DIR)} — nothing applied`,
  )
  process.exit(1)
}

const wanted = only ? layouts.filter((l) => only.has(l.id)) : layouts
if (only) {
  for (const id of only) {
    if (!layouts.some((l) => l.id === id)) console.warn(`[layouts] no layout file for ${id}`)
  }
}

const config = loadConfig()
const db = openDb(path.join(config.dataDir, "mimema.sqlite"))
const store = new Store(db, config.dataDir)

let unchanged = 0
let updated = 0
let missing = 0

for (const layout of wanted) {
  const row = store.templateById(layout.id)
  if (!row) {
    missing++
    console.warn(`[layouts] ${layout.id}: not in this data dir — skipped`)
    continue
  }
  // Compare through the schema in both directions: the stored JSON predates
  // whatever defaults the schema grew, and a layout only writes the fields its
  // author cared about. Normalised, "same layout" means the same bytes.
  const stored = zonesSchema.safeParse(JSON.parse(row.zones_json))
  if (stored.success && isDeepStrictEqual(stored.data, layout.zones)) {
    unchanged++
    continue
  }
  if (!dryRun) store.setTemplateZones(layout.id, layout.zones)
  updated++
  console.log(
    `[layouts] ${dryRun ? "would update" : "updated"} ${layout.id} — ` +
      `${stored.success ? stored.data.length : "?"} → ${layout.zones.length} zone` +
      `${layout.zones.length === 1 ? "" : "s"}: ` +
      layout.zones.map((z) => z.placeholder).join(" | "),
  )
}

console.log(
  `[layouts] ${dryRun ? "would update" : "updated"} ${updated}, unchanged ${unchanged}` +
    (missing ? `, missing-in-db ${missing}` : "") +
    ` — ${layouts.length} layout file${layouts.length === 1 ? "" : "s"} on disk`,
)
db.close()
