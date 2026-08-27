import { afterAll, beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Hono } from "hono"
import { openDb } from "./db.ts"
import { createApp } from "./app.ts"
import { loadConfig } from "./config.ts"
import { Store, templateDto } from "./store.ts"
import { defaultZones } from "../shared/schema.ts"
import type { TemplateDto } from "../shared/schema.ts"

// A real PNG signature with a 320x200 IHDR — enough for sniff + imageSize.
function fakePng(extra = 0): Buffer {
  const buf = Buffer.alloc(64)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  buf.set([0x00, 0x00, 0x00, 0x0d], 8)
  buf.set([0x49, 0x48, 0x44, 0x52], 12)
  buf.writeUInt32BE(320, 16)
  buf.writeUInt32BE(200, 20)
  buf[63] = extra % 251
  return buf
}

let dir: string
let store: Store
let app: Hono

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimema-store-"))
  const config = loadConfig({ DATA_DIR: dir, INVITE_KEY: "k", RATE_LIMIT: "0" })
  const db = openDb(path.join(dir, "mimema.sqlite"))
  store = new Store(db, dir)
  app = createApp(config, openDb(path.join(dir, "mimema.sqlite"))).app
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("template attribution", () => {
  it("stores and surfaces sourceUrl on the DTO", () => {
    const row = store.createTemplate({
      id: "ancient-aliens-guy",
      name: "Ancient Aliens Guy",
      source: "memegen",
      ext: "png",
      width: 320,
      height: 200,
      zones: defaultZones(2),
      data: fakePng(1),
      sourceUrl: "https://knowyourmeme.com/memes/ancient-aliens",
      sourceRef: "aag",
    })
    expect(row.source_url).toBe("https://knowyourmeme.com/memes/ancient-aliens")
    expect(row.source_ref).toBe("aag")

    const dto = templateDto(row)
    expect(dto.source).toBe("memegen")
    expect(dto.sourceUrl).toBe("https://knowyourmeme.com/memes/ancient-aliens")
    expect(dto.zones).toHaveLength(2)
  })

  it("leaves sourceUrl null when no upstream is given", () => {
    const row = store.createTemplate({
      id: "wait-what",
      name: "Wait What",
      source: "custom",
      ext: "png",
      width: 320,
      height: 200,
      zones: defaultZones(1),
      data: fakePng(2),
    })
    expect(templateDto(row).sourceUrl).toBeNull()
  })

  it("serves sourceUrl through the templates route", async () => {
    store.createTemplate({
      id: "drake-hotline-bling",
      name: "Drake Hotline Bling",
      source: "imgflip",
      ext: "png",
      width: 320,
      height: 200,
      zones: defaultZones(2),
      data: fakePng(3),
      sourceUrl: "https://imgflip.com/memetemplate/181913649",
      sourceRef: "181913649",
    })

    const one = (await (
      await app.request("/api/templates/drake-hotline-bling")
    ).json()) as TemplateDto
    expect(one.sourceUrl).toBe("https://imgflip.com/memetemplate/181913649")

    const list = (await (await app.request("/api/templates")).json()) as TemplateDto[]
    const custom = list.find((t) => t.id === "wait-what")
    expect(custom?.sourceUrl).toBeNull()
    expect(list.map((t) => t.sourceUrl).filter(Boolean)).toHaveLength(2)
  })
})
