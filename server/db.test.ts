import { afterAll, beforeAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { MIGRATIONS, openDb } from "./db.ts"

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimema-db-"))
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const userVersion = (db: DatabaseSync): number =>
  (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version

const tables = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as {
    name: string
  }[]).map((r) => r.name)

describe("migrations", () => {
  it("brings a fresh database to the top of the ladder", () => {
    const db = openDb(path.join(dir, "fresh.sqlite"))
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(tables(db)).toEqual(expect.arrayContaining(["items", "item_tags", "item_reactions"]))
    db.close()
  })

  it("upgrades an existing v1 database in place, keeping its rows", () => {
    const file = path.join(dir, "legacy.sqlite")
    const v1 = new DatabaseSync(file)
    v1.exec(MIGRATIONS[0]!)
    v1.exec("PRAGMA user_version = 1")
    v1.exec(
      `INSERT INTO items (slug, kind, title, template_id, mime, ext, bytes, sha256, created_at)
       VALUES ('old-relic', 'upload', 'relic', NULL, 'image/png', 'png', 10, 'deadbeef', 1)`,
    )
    v1.close()

    const db = openDb(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(tables(db)).toEqual(expect.arrayContaining(["item_tags", "item_reactions"]))
    const row = db.prepare("SELECT slug FROM items").get() as { slug: string }
    expect(row.slug).toBe("old-relic")

    // and the new tables are usable against that pre-existing row
    const id = (db.prepare("SELECT id FROM items WHERE slug = 'old-relic'").get() as { id: number })
      .id
    db.prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, 'ancient')").run(id)
    db.prepare("DELETE FROM items WHERE id = ?").run(id)
    expect(db.prepare("SELECT COUNT(*) AS n FROM item_tags").get()).toEqual({ n: 0 })
    db.close()
  })

  it("rebuilds templates for v3: attribution columns, widened source, FKs intact", () => {
    const file = path.join(dir, "v2.sqlite")
    const v2 = new DatabaseSync(file)
    v2.exec(MIGRATIONS[0]!)
    v2.exec(MIGRATIONS[1]!)
    v2.exec("PRAGMA user_version = 2")
    v2.exec(
      `INSERT INTO templates (id, name, source, ext, width, height, zones_json, created_at)
       VALUES ('drake', 'Drake', 'imgflip', 'jpg', 1200, 1200, '[]', 1)`,
    )
    v2.exec(
      `INSERT INTO items (slug, kind, title, template_id, mime, ext, bytes, sha256, created_at)
       VALUES ('a-meme', 'meme', 'x', 'drake', 'image/png', 'png', 10, 'cafe', 1)`,
    )
    v2.close()

    const db = openDb(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)

    // the old row survives the table rebuild, with NULL attribution
    expect(db.prepare("SELECT source_url, source_ref FROM templates WHERE id = 'drake'").get()).
      toEqual({ source_url: null, source_ref: null })
    // and so does the item that points at it
    expect(db.prepare("SELECT template_id FROM items WHERE slug = 'a-meme'").get()).toEqual({
      template_id: "drake",
    })

    // the widened CHECK admits memegen but still refuses nonsense
    db.prepare(
      `INSERT INTO templates (id, name, source, ext, width, height, zones_json, created_at, source_url, source_ref)
       VALUES ('aag', 'Ancient Aliens Guy', 'memegen', 'jpg', 620, 465, '[]', 2, 'https://example.test/aag', 'aag')`,
    ).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO templates (id, name, source, ext, width, height, zones_json, created_at)
           VALUES ('nope', 'Nope', 'tumblr', 'jpg', 1, 1, '[]', 3)`,
        )
        .run(),
    ).toThrow()

    // foreign keys came back ON, and ON DELETE SET NULL still fires
    expect(() =>
      db
        .prepare(
          `INSERT INTO items (slug, kind, title, template_id, mime, ext, bytes, sha256, created_at)
           VALUES ('orphan', 'meme', 'x', 'ghost', 'image/png', 'png', 10, 'beef', 4)`,
        )
        .run(),
    ).toThrow()
    db.prepare("DELETE FROM templates WHERE id = 'drake'").run()
    expect(db.prepare("SELECT template_id FROM items WHERE slug = 'a-meme'").get()).toEqual({
      template_id: null,
    })
    db.close()
  })

  it("is idempotent across reopens", () => {
    const file = path.join(dir, "reopen.sqlite")
    openDb(file).close()
    const db = openDb(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    db.close()
  })
})
