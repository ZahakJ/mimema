#!/usr/bin/env node
/**
 * Renders a template through the real editor and writes the PNG — the proof
 * that a curated layout in scripts/layouts/ actually sits on the picture.
 *
 * There is no second render path: this drives the deep link (#/edit/<id>?c=…),
 * waits for body[data-doc-ready="<id>"], and calls window.__mimema.exportPng(),
 * which is the download button's own path at native template resolution. What
 * lands in the PNG is what a human gets in the forge.
 *
 *   node tools/render-proof.mjs --out /tmp/drake.png drake-hotline-bling
 *   node tools/render-proof.mjs --out /tmp/drake.png drake-hotline-bling \
 *     "node 20" "node 26"
 *   node tools/render-proof.mjs --batch ids.txt --outdir /tmp/proofs
 *
 * With no captions the template's own placeholders are used — which is the
 * point when you are proofing a layout: the placeholders ARE the layout's
 * claim about what each box means, and long ones show you the worst case.
 *
 * Flags:
 *   --origin <url>   where a Mimema is listening (default http://127.0.0.1:6901)
 *   --out <file>     PNG path, single-template mode
 *   --batch <file>   one template id per line (# comments and blanks ignored);
 *                    one browser is reused for all of them
 *   --outdir <dir>   where batch mode writes <id>.png (default .)
 *
 * Point it at a throwaway server with its own DATA_DIR while you iterate;
 * :8001 is the live site.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { chromium } from "playwright"

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1]
}
const origin = (flag("--origin", "http://127.0.0.1:6901") ?? "").replace(/\/+$/, "")
const out = flag("--out")
const batch = flag("--batch")
const outdir = flag("--outdir", ".")

// positional args: the template id, then any captions
const flags = new Set(["--origin", "--out", "--batch", "--outdir"])
const positional = argv.filter((a, i) => !a.startsWith("--") && !flags.has(argv[i - 1]))

const targets = batch
  ? readFileSync(batch, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean)
      .map((id) => ({ id, captions: [], file: join(outdir, `${id}.png`) }))
  : positional.length
    ? [{ id: positional[0], captions: positional.slice(1), file: out }]
    : []

if (targets.length === 0) {
  console.error("usage: render-proof.mjs [--origin url] --out file.png <templateId> [caption …]")
  console.error("       render-proof.mjs [--origin url] --batch ids.txt [--outdir dir]")
  process.exit(2)
}
if (!batch && !out) {
  console.error("render-proof.mjs: --out <file.png> is required in single-template mode")
  process.exit(2)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const problems = []
page.on("pageerror", (err) => problems.push(String(err)))
page.on("console", (msg) => {
  if (msg.type() === "error") problems.push(msg.text())
})

let failed = 0
try {
  for (const target of targets) {
    try {
      await proof(target)
      console.log(`  ✓ ${target.id} → ${target.file}`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${target.id}: ${err instanceof Error ? err.message : err}`)
    }
  }
} finally {
  await browser.close()
}
if (problems.length) console.warn(`[proof] page reported: ${[...new Set(problems)].join("; ")}`)
process.exit(failed ? 1 : 0)

async function proof({ id, captions, file }) {
  // Falling back to the template's placeholders needs the template anyway, and
  // fetching it first turns "no such template" into a clear message instead of
  // a ten-second wait for a doc that will never be ready.
  const res = await fetch(`${origin}/api/templates/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`GET /api/templates/${id} → HTTP ${res.status}`)
  const template = await res.json()
  const texts = captions.length
    ? captions
    : template.zones.map((z, i) => z.placeholder || `TEXT ${i + 1}`)

  // encodeURIComponent, not URLSearchParams: the router reads the hash with
  // decodeURIComponent, which turns %20 into a space and leaves + as a plus.
  const query = texts.map((t) => `c=${encodeURIComponent(t)}`).join("&")
  await page.goto(`${origin}/#/edit/${encodeURIComponent(id)}?${query}`, {
    waitUntil: "networkidle",
  })
  await page.waitForSelector(`body[data-doc-ready="${cssEscape(id)}"]`, { timeout: 15000 })
  // the fonts are loaded before the first paint, but give the canvas a beat
  await page.waitForTimeout(250)

  const dataUrl = await page.evaluate(() => window.__mimema.exportPng())
  if (!dataUrl.startsWith("data:image/png"))
    throw new Error(`exportPng() gave back ${dataUrl.slice(0, 32)}…`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"))
}

/** Template ids are slugs, but an attribute selector still can't take a quote. */
function cssEscape(value) {
  return value.replace(/["\\]/g, "\\$&")
}
