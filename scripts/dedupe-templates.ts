// Prunes the duplicate templates listed in duplicates.ts out of an existing
// data/ dir. fetch-templates.ts refuses them at the door now, so a pack pulled
// fresh never needs this — it's for the packs pulled before the list grew.
//
// Deliberately NOT part of `npm run templates`: that command is idempotent and
// promises never to disturb your customs, and a delete has no business hiding
// inside it. This one deletes, so you run it on purpose.
//
//   npm run templates:dedupe -- --dry-run   # say what would go
//   npm run templates:dedupe                # do it
//
// Safe to re-run: a duplicate that's already gone is simply not there. Items
// forged from a dropped template are repointed at the survivor first, so their
// "remix this template" link keeps working.
import path from "node:path"
import { loadConfig } from "../server/config.ts"
import { openDb } from "../server/db.ts"
import { Store } from "../server/store.ts"
import { DUPLICATE_GROUPS } from "./duplicates.ts"

const dryRun = process.argv.includes("--dry-run")

const config = loadConfig()
const db = openDb(path.join(config.dataDir, "mimema.sqlite"))
const store = new Store(db, config.dataDir)

const before = store.listTemplates().length
let dropped = 0
let repointed = 0
let renamed = 0
let orphaned = 0

for (const group of DUPLICATE_GROUPS) {
  const keeper = store.templateById(group.keep)
  const present = group.drop.filter((id) => store.templateById(id) !== undefined)
  if (present.length === 0) continue

  // Refuse to delete the only copy: if the survivor isn't here (a hand-pruned
  // data dir, a renamed template), the duplicate is all that's left of the meme.
  if (!keeper) {
    console.warn(
      `[dedupe] keeping ${present.join(", ")} — their survivor ${group.keep} isn't in this pack`,
    )
    orphaned += present.length
    continue
  }

  for (const id of present) {
    const moved = dryRun ? store.countItemsForTemplate(id) : store.repointItems(id, group.keep)
    repointed += moved
    if (!dryRun) store.deleteTemplate(id)
    dropped++
    console.log(
      `[dedupe] ${dryRun ? "would drop" : "dropped"} ${id} → ${group.keep}` +
        (moved ? ` (${moved} item${moved === 1 ? "" : "s"} repointed)` : "") +
        ` — ${group.note}`,
    )
  }

  if (group.rename && keeper.name !== group.rename) {
    if (!dryRun) store.renameTemplate(group.keep, group.rename)
    renamed++
    console.log(
      `[dedupe] ${dryRun ? "would rename" : "renamed"} ${group.keep}: ` +
        `"${keeper.name}" → "${group.rename}"`,
    )
  }
}

console.log(
  `[dedupe] ${dryRun ? "would drop" : "dropped"} ${dropped}, renamed ${renamed}, ` +
    `repointed ${repointed} item${repointed === 1 ? "" : "s"}` +
    (orphaned ? `, left ${orphaned} without a survivor` : "") +
    ` — ${before} template${before === 1 ? "" : "s"} before` +
    (dryRun ? "" : `, ${store.listTemplates().length} after`),
)
db.close()
