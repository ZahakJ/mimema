import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"

export function openDb(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  migrate(db)
  return db
}

// The ladder: index i is the step that takes user_version from i to i+1.
// Append only — never edit a rung that has shipped.
export const MIGRATIONS: string[] = [
  `
    CREATE TABLE templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      source      TEXT NOT NULL CHECK (source IN ('imgflip','custom','seed')),
      ext         TEXT NOT NULL,
      width       INTEGER NOT NULL,
      height      INTEGER NOT NULL,
      zones_json  TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE items (
      id          INTEGER PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      kind        TEXT NOT NULL CHECK (kind IN ('meme','upload')),
      title       TEXT NOT NULL DEFAULT '',
      template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
      mime        TEXT NOT NULL,
      ext         TEXT NOT NULL,
      bytes       INTEGER NOT NULL,
      width       INTEGER,
      height      INTEGER,
      sha256      TEXT NOT NULL UNIQUE,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX items_created ON items(created_at DESC, id DESC);
    CREATE INDEX items_template ON items(template_id);
  `,
  `
    CREATE TABLE item_tags (
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      tag     TEXT NOT NULL,
      PRIMARY KEY (item_id, tag)
    );
    CREATE INDEX item_tags_tag ON item_tags(tag);

    CREATE TABLE item_reactions (
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      emoji   TEXT NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (item_id, emoji)
    );
  `,
  // Attribution columns + a second import source. The source CHECK has to be
  // widened, and SQLite can only do that by rebuilding the table — so this is
  // the documented 12-step dance rather than an ALTER. foreign_keys must be OFF
  // across the swap: with it ON, DROP TABLE templates would run an implicit
  // delete that NULLs every items.template_id, and the RENAME would rewrite
  // items' REFERENCES clause to point at the scratch name.
  `
    PRAGMA foreign_keys = OFF;

    CREATE TABLE templates_v3 (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      source      TEXT NOT NULL CHECK (source IN ('imgflip','memegen','custom','seed')),
      ext         TEXT NOT NULL,
      width       INTEGER NOT NULL,
      height      INTEGER NOT NULL,
      zones_json  TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      source_url  TEXT,
      source_ref  TEXT
    );
    INSERT INTO templates_v3 (id, name, source, ext, width, height, zones_json, created_at)
      SELECT id, name, source, ext, width, height, zones_json, created_at FROM templates;
    DROP TABLE templates;
    ALTER TABLE templates_v3 RENAME TO templates;

    PRAGMA foreign_keys = ON;
  `,
]

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number }
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v]!)
    // PRAGMA takes no bind parameters; v is a loop counter, not input
    db.exec(`PRAGMA user_version = ${v + 1}`)
  }
}
