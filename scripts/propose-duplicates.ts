// Proposes duplicate template pairs by looking at the pixels.
//
// Name matching is blind: the two packs ship the same picture under different
// titles ("Expectation vs Reality" / "Disappointed Black Guy"), and only the
// curated one gets a text layout, so the picker hands you the twin with the
// generic bands over the face. duplicates.ts is the cure, but it is hand
// written — this is what fills it.
//
// It PROPOSES. It never edits duplicates.ts, and its output is not a patch:
// a 64-bit dHash calls every four-panel comic a duplicate of every other, and
// would merge the four Socially * Penguins, which are four different memes.
// Read both images, then write the pair down by hand.
//
//   node scripts/propose-duplicates.ts [--threshold N] [--limit N] [--all]
//
//   --threshold N  max Hamming distance to report (default 10, of 64 bits)
//   --limit N      stop after N pairs (default 60)
//   --all          include pairs duplicates.ts already knows about
//
// Two hashes per image, and the smaller distance wins:
//   flat     dHash of the whole frame squashed to 9x8 — catches a rescale or
//            a re-encode of the same file.
//   content  the same hash after the blank gutters are dropped — the packs
//            crop the same meme to different aspect ratios (expectation-vs-
//            reality is disappointed-black-guy with less white beside the
//            face), which slides every feature sideways and blinds `flat`.
//
// Needs ImageMagick (`magick`) on PATH — it does the decode and the grayscale
// downscale; the hashes themselves are here.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { loadConfig } from "../server/config.ts"
import { DUPLICATE_ALIASES, DUPLICATE_GROUPS } from "./duplicates.ts"

const arg = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag)
  if (i === -1) return fallback
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) ? n : fallback
}
const threshold = arg("--threshold", 10)
const limit = arg("--limit", 60)
const includeKnown = process.argv.includes("--all")

const config = loadConfig()
const dir = path.join(config.dataDir, "templates")

type Gray = { px: Uint8Array; w: number; h: number }

/** Decode to a squashed WxH grayscale raster, one byte per pixel. */
function gray(file: string, w: number, h: number): Gray {
  const px = execFileSync(
    "magick",
    [`${file}[0]`, "-colorspace", "Gray", "-resize", `${w}x${h}!`, "-depth", "8", "gray:-"],
    { maxBuffer: 1 << 22 },
  )
  return { px: new Uint8Array(px.buffer, px.byteOffset, w * h), w, h }
}

const at = (g: Gray, x: number, y: number): number => g.px[y * g.w + x] ?? 0

/** dHash: one bit per "is this cell brighter than the one to its right", read
 *  off a 9x8 sampling of the raster. Brightness-invariant, so a rescale or a
 *  re-encode of the same picture lands on the same 64 bits. */
function dhash(g: Gray): bigint {
  let bits = 0n
  for (let y = 0; y < 8; y++) {
    const sy = Math.min(g.h - 1, Math.floor(((y + 0.5) * g.h) / 8))
    for (let x = 0; x < 8; x++) {
      const sx = (i: number) => Math.min(g.w - 1, Math.floor((i * g.w) / 9))
      bits = (bits << 1n) | (at(g, sx(x), sy) > at(g, sx(x + 1), sy) ? 1n : 0n)
    }
  }
  return bits
}

/** The same raster with its blank gutters removed: any row or column that is
 *  ~90% one flat tone (the white margin a meme template leaves for captions)
 *  carries no picture, and the two packs leave different amounts of it. Drop
 *  it and the pictures line up again. */
function trimGutters(g: Gray): Gray {
  const flat = (vals: number[]): boolean => {
    const mid = vals.slice().sort((a, b) => a - b)[vals.length >> 1] ?? 0
    return vals.filter((v) => Math.abs(v - mid) <= 12).length >= vals.length * 0.9
  }
  const rows: number[] = []
  for (let y = 0; y < g.h; y++) {
    const vals = Array.from({ length: g.w }, (_, x) => at(g, x, y))
    if (!flat(vals)) rows.push(y)
  }
  const cols: number[] = []
  for (let x = 0; x < g.w; x++) {
    const vals = Array.from({ length: g.h }, (_, y) => at(g, x, y))
    if (!flat(vals)) cols.push(x)
  }
  // All gutter (a solid-colour template) — nothing to trim to, keep the frame.
  if (rows.length < 4 || cols.length < 4) return g
  const px = new Uint8Array(rows.length * cols.length)
  rows.forEach((y, j) => cols.forEach((x, i) => (px[j * cols.length + i] = at(g, x, y))))
  return { px, w: cols.length, h: rows.length }
}

const hamming = (a: bigint, b: bigint): number => {
  let v = a ^ b
  let n = 0
  while (v) {
    v &= v - 1n
    n++
  }
  return n
}

/** Pairs already settled: a known group's members are duplicates of each
 *  other, so every combination inside one group is old news. */
const known = new Set<string>()
for (const g of DUPLICATE_GROUPS) {
  const members = [g.keep, ...g.drop]
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      known.add([members[i], members[j]].sort().join("|"))
    }
  }
}
// …and a dropped id is an alias of its keeper, so a pair touching it is really
// a pair touching the keeper.
const resolve = (id: string): string => DUPLICATE_ALIASES.get(id) ?? id

const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
const entries: { id: string; flat: bigint; content: bigint }[] = []
for (const file of files) {
  const id = file.replace(/\.[^.]+$/, "")
  try {
    const g = gray(path.join(dir, file), 64, 64)
    entries.push({ id, flat: dhash(g), content: dhash(trimGutters(g)) })
  } catch (err) {
    console.warn(`[propose] skipped ${file}: ${(err as Error).message.split("\n")[0]}`)
  }
}
console.log(`[propose] hashed ${entries.length} templates, threshold ${threshold}/64`)

const pairs: { a: string; b: string; d: number; via: string }[] = []
for (let i = 0; i < entries.length; i++) {
  for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i]!
    const b = entries[j]!
    const flat = hamming(a.flat, b.flat)
    const content = hamming(a.content, b.content)
    const d = Math.min(flat, content)
    if (d > threshold) continue
    const key = [resolve(a.id), resolve(b.id)].sort().join("|")
    if (!includeKnown && (known.has(key) || resolve(a.id) === resolve(b.id))) continue
    pairs.push({ a: a.id, b: b.id, d, via: `flat ${flat}, content ${content}` })
  }
}
pairs.sort((x, y) => x.d - y.d || x.a.localeCompare(y.a))

for (const { a, b, d, via } of pairs.slice(0, limit)) {
  console.log(`${String(d).padStart(2)}  ${a}  <->  ${b}   (${via})`)
}
console.log(
  `[propose] ${pairs.length} candidate pair${pairs.length === 1 ? "" : "s"}` +
    (pairs.length > limit ? ` (showing ${limit})` : "") +
    " — every one needs an eye on both images before it goes in duplicates.ts",
)
