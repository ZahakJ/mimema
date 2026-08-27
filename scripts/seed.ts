// Imports the pre-mimema relics (the fly, the ducks) as the first two wall
// items. Idempotent — sha256 dedup makes re-runs no-ops.
import fs from "node:fs"
import path from "node:path"
import { loadConfig } from "../server/config.ts"
import { openDb } from "../server/db.ts"
import { Store } from "../server/store.ts"
import { sniff } from "../server/sniff.ts"
import { imageSize } from "../server/imageSize.ts"

const config = loadConfig()
const db = openDb(path.join(config.dataDir, "mimema.sqlite"))
const store = new Store(db, config.dataDir)

const seedDir = path.join(import.meta.dirname, "..", "seed-assets")
const seeds: { file: string; title: string }[] = [
  { file: "fly.webp", title: "the fly" },
  { file: "ducks_follow_dog.mp4", title: "ducks follow dog" },
]

for (const seed of seeds) {
  const filePath = path.join(seedDir, seed.file)
  if (!fs.existsSync(filePath)) {
    console.warn(`[seed] missing ${seed.file}, skipping`)
    continue
  }
  const data = fs.readFileSync(filePath)
  const sniffed = sniff(data)
  if (!sniffed) {
    console.warn(`[seed] ${seed.file}: unrecognized format, skipping`)
    continue
  }
  const dims = sniffed.kind === "image" ? imageSize(data, sniffed.ext) : null
  const row = store.createItem({
    kind: "upload",
    title: seed.title,
    templateId: null,
    mime: sniffed.mime,
    ext: sniffed.ext,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    data,
  })
  console.log(`[seed] ${seed.title} → /m/${row.slug}.${row.ext}`)
}

db.close()
