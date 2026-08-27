#!/usr/bin/env node
/**
 * Smoke test: build (unless --no-build), start the real server on :6901 with a
 * throwaway DATA_DIR, seed a template + item through the actual API, then load
 * every route in headless Chromium — wait for body[data-app-ready="1"], fail on
 * any console error, save screenshots/<route>.png.
 *
 *   node tools/screenshot.mjs [--no-build]
 */
import { spawn, execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"
import { chromium } from "playwright"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const PORT = 6901
const KEY = "smoke-key"
const ORIGIN = `http://127.0.0.1:${PORT}`

const noBuild = process.argv.includes("--no-build")

if (!noBuild) {
  console.log("building…")
  execSync("npm run build", { cwd: ROOT, stdio: "pipe" })
}
mkdirSync(join(ROOT, "screenshots"), { recursive: true })

const dataDir = mkdtempSync(join(tmpdir(), "mimema-smoke-"))
const server = spawn("node", ["server/index.ts"], {
  cwd: ROOT,
  stdio: "pipe",
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, INVITE_KEY: KEY, PUBLIC_ORIGIN: ORIGIN },
})

let failed = false
try {
  await waitFor(`${ORIGIN}/healthz`, 15000)

  // seed through the real API: one template, one published item
  const png = fakePng()
  const tplForm = new FormData()
  tplForm.set("image", new File([png], "smoke.png"))
  tplForm.set("meta", JSON.stringify({ name: "Smoke Template", zones: [{ x: 0.05, y: 0.05, w: 0.9, h: 0.3 }] }))
  const tplRes = await fetch(`${ORIGIN}/api/templates`, {
    method: "POST",
    body: tplForm,
    headers: { "x-meme-key": KEY },
  })
  if (tplRes.status !== 201) throw new Error(`template seed failed: ${tplRes.status}`)

  const itemForm = new FormData()
  itemForm.set("file", new File([png], "smoke.png"))
  itemForm.set("kind", "meme")
  itemForm.set("title", "smoke artifact")
  const itemRes = await fetch(`${ORIGIN}/api/items`, {
    method: "POST",
    body: itemForm,
    headers: { "x-meme-key": KEY },
  })
  if (itemRes.status !== 201) throw new Error(`item seed failed: ${itemRes.status}`)
  const item = await itemRes.json()

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => errors.push(String(err)))

  const routes = [
    ["forge", "/#/"],
    ["wall", "/#/wall"],
    ["add-template", "/#/add-template"],
  ]
  for (const [name, path] of routes) {
    await page.goto(`${ORIGIN}${path}`, { waitUntil: "networkidle" })
    await page.waitForSelector('body[data-app-ready="1"]', { timeout: 10000 })
    if (name === "forge") {
      // open a template so the canvas actually renders
      await page.click(".mm-thumb")
      await page.waitForSelector(".mm-stage__canvas", { timeout: 5000 })
      await page.waitForTimeout(400)
    }
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(ROOT, "screenshots", `${name}.png`) })
    console.log(`  ✓ ${name}`)
  }

  // share page is server-rendered — no app-ready marker
  await page.goto(`${ORIGIN}${item.shareUrl}`, { waitUntil: "networkidle" })
  await page.screenshot({ path: join(ROOT, "screenshots", "share.png") })
  console.log("  ✓ share")

  await browser.close()

  if (errors.length) {
    console.error(`FAIL — ${errors.length} console error(s):`)
    for (const e of errors) console.error(`  ${e}`)
    failed = true
  } else {
    console.log("smoke green — screenshots/ updated")
  }
} catch (err) {
  console.error(`FAIL — ${err instanceof Error ? err.message : err}`)
  failed = true
} finally {
  server.kill()
  rmSync(dataDir, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)

async function waitFor(url, ms) {
  const deadline = Date.now() + ms
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up at ${url}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** A real, decodable 400x300 PNG (magenta gradient) built with node:zlib. */
function fakePng() {
  const W = 400
  const H = 300
  const raw = Buffer.alloc(H * (1 + W * 3))
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3)
    raw[row] = 0 // filter: none
    for (let x = 0; x < W; x++) {
      const o = row + 1 + x * 3
      raw[o] = 200 + Math.floor((x / W) * 55)
      raw[o + 1] = 30
      raw[o + 2] = 120 + Math.floor((y / H) * 100)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c
}
