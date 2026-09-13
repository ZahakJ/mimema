import type { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import type {
  ItemDto,
  ItemSort,
  TagCountDto,
  TemplateDto,
  TemplateSource,
  Zone,
} from "../shared/schema.ts"
import { TAGS_PER_ITEM, zonesSchema } from "../shared/schema.ts"
import { uniqueSlug } from "./slugs.ts"

// All DB access + blob bookkeeping in one place; routes stay thin.

export type ItemRow = {
  id: number
  slug: string
  kind: "meme" | "upload"
  title: string
  template_id: string | null
  mime: string
  ext: string
  bytes: number
  width: number | null
  height: number | null
  sha256: string
  created_at: number
}

export type TemplateRow = {
  id: string
  name: string
  source: TemplateSource
  ext: string
  width: number
  height: number
  zones_json: string
  created_at: number
  /** upstream page the import came from — NULL for customs and pre-v3 rows */
  source_url: string | null
  /** upstream id at that source (imgflip's numeric id, memegen's slug) */
  source_ref: string | null
}

/** deduped is true when sha256 matched an existing row and nothing was written */
export type CreatedItem = ItemRow & { deduped: boolean }

export function itemDto(
  row: ItemRow,
  tags: string[] = [],
  reactions: Record<string, number> = {},
): ItemDto {
  return {
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    templateId: row.template_id,
    mime: row.mime,
    ext: row.ext,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    url: `/m/${row.slug}.${row.ext}`,
    shareUrl: `/m/${row.slug}`,
    createdAt: row.created_at,
    tags,
    reactions,
  }
}

export function templateDto(row: TemplateRow): TemplateDto {
  let zones: Zone[] = []
  const parsed = zonesSchema.safeParse(JSON.parse(row.zones_json))
  if (parsed.success) zones = parsed.data
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    ext: row.ext,
    width: row.width,
    height: row.height,
    zones,
    imageUrl: `/t/${row.id}.${row.ext}`,
    sourceUrl: row.source_url ?? null,
    createdAt: row.created_at,
  }
}

export class Store {
  private db: DatabaseSync
  private dataDir: string

  constructor(db: DatabaseSync, dataDir: string) {
    this.db = db
    this.dataDir = dataDir
    fs.mkdirSync(this.mediaDir, { recursive: true })
    fs.mkdirSync(this.templatesDir, { recursive: true })
  }

  get mediaDir(): string {
    return path.join(this.dataDir, "media")
  }
  get templatesDir(): string {
    return path.join(this.dataDir, "templates")
  }

  mediaPath(slug: string, ext: string): string {
    return path.join(this.mediaDir, `${slug}.${ext}`)
  }
  templatePath(id: string, ext: string): string {
    return path.join(this.templatesDir, `${id}.${ext}`)
  }

  // ————— items —————

  itemBySlug(slug: string): ItemRow | undefined {
    return this.db.prepare("SELECT * FROM items WHERE slug = ?").get(slug) as ItemRow | undefined
  }

  itemBySha(sha256: string): ItemRow | undefined {
    return this.db.prepare("SELECT * FROM items WHERE sha256 = ?").get(sha256) as
      | ItemRow
      | undefined
  }

  listItems(opts: {
    q?: string
    template?: string
    tag?: string
    sort?: ItemSort
    cursor?: { createdAt: number; id: number }
    limit: number
  }): { rows: ItemRow[]; hasMore: boolean } {
    const sort = opts.sort ?? "new"
    const cond: string[] = []
    const args: (string | number)[] = []
    if (opts.q) {
      cond.push("(i.title LIKE ? OR i.slug LIKE ?)")
      const like = `%${opts.q.replaceAll("%", "").replaceAll("_", "")}%`
      args.push(like, like)
    }
    if (opts.template) {
      cond.push("i.template_id = ?")
      args.push(opts.template)
    }
    if (opts.tag) {
      cond.push("EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag = ?)")
      args.push(opts.tag)
    }
    // top is single-page (no cursor) — ranking by a mutable count can't be
    // paged by a stable keyset, and the wall's top slice is small anyway
    if (opts.cursor && sort !== "top") {
      const cmp = sort === "old" ? ">" : "<"
      cond.push(`(i.created_at ${cmp} ? OR (i.created_at = ? AND i.id ${cmp} ?))`)
      args.push(opts.cursor.createdAt, opts.cursor.createdAt, opts.cursor.id)
    }
    const where = cond.length ? `WHERE ${cond.join(" AND ")}` : ""
    const order =
      sort === "old"
        ? "i.created_at ASC, i.id ASC"
        : sort === "top"
          ? "total DESC, i.created_at DESC, i.id DESC"
          : "i.created_at DESC, i.id DESC"
    const total =
      sort === "top"
        ? ", COALESCE((SELECT SUM(r.count) FROM item_reactions r WHERE r.item_id = i.id), 0) AS total"
        : ""
    const rows = this.db
      .prepare(`SELECT i.*${total} FROM items i ${where} ORDER BY ${order} LIMIT ?`)
      .all(...args, opts.limit + 1) as unknown as ItemRow[]
    const hasMore = rows.length > opts.limit
    return { rows: hasMore ? rows.slice(0, opts.limit) : rows, hasMore }
  }

  createItem(input: {
    kind: "meme" | "upload"
    title: string
    templateId: string | null
    mime: string
    ext: string
    width: number | null
    height: number | null
    tags?: string[]
    data: Buffer
  }): CreatedItem {
    const sha256 = crypto.createHash("sha256").update(input.data).digest("hex")
    const existing = this.itemBySha(sha256)
    if (existing) {
      // same bytes, possibly new labels — fold them in rather than lose them
      if (input.tags?.length) this.mergeTags(existing.id, input.tags)
      return { ...existing, deduped: true }
    }

    const slug = uniqueSlug((s) => this.itemBySlug(s) !== undefined)
    const file = this.mediaPath(slug, input.ext)
    fs.writeFileSync(file, input.data)
    // template_id must point at a real template or be null (FK)
    const templateId =
      input.templateId && this.templateById(input.templateId) ? input.templateId : null
    try {
      this.db
        .prepare(
          `INSERT INTO items (slug, kind, title, template_id, mime, ext, bytes, width, height, sha256, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          slug,
          input.kind,
          input.title,
          templateId,
          input.mime,
          input.ext,
          input.data.byteLength,
          input.width,
          input.height,
          sha256,
          Date.now(),
        )
    } catch (err) {
      // no row will ever reference this blob — don't leave it orphaned on disk
      fs.rmSync(file, { force: true })
      throw err
    }
    const row = this.itemBySlug(slug)!
    if (input.tags?.length) this.setTags(row.id, input.tags)
    return { ...row, deduped: false }
  }

  updateItem(slug: string, patch: { title?: string; tags?: string[] }): ItemRow | undefined {
    const row = this.itemBySlug(slug)
    if (!row) return undefined
    if (patch.title !== undefined) {
      this.db
        .prepare("UPDATE items SET title = ? WHERE id = ?")
        .run(patch.title.slice(0, 140), row.id)
    }
    if (patch.tags !== undefined) this.setTags(row.id, patch.tags)
    return this.itemBySlug(slug)
  }

  deleteItem(slug: string): boolean {
    const row = this.itemBySlug(slug)
    if (!row) return false
    this.db.prepare("DELETE FROM items WHERE slug = ?").run(slug)
    fs.rmSync(this.mediaPath(row.slug, row.ext), { force: true })
    return true
  }

  // ————— tags —————

  tagsOf(itemId: number): string[] {
    return (
      this.db
        .prepare("SELECT tag FROM item_tags WHERE item_id = ? ORDER BY tag")
        .all(itemId) as unknown as { tag: string }[]
    ).map((r) => r.tag)
  }

  setTags(itemId: number, tags: string[]): void {
    this.db.prepare("DELETE FROM item_tags WHERE item_id = ?").run(itemId)
    const insert = this.db.prepare("INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)")
    for (const tag of tags.slice(0, TAGS_PER_ITEM)) insert.run(itemId, tag)
  }

  /** union with what's already there, existing tags winning the cap */
  mergeTags(itemId: number, tags: string[]): void {
    const existing = this.tagsOf(itemId)
    const merged = [...existing]
    for (const tag of tags) if (!merged.includes(tag)) merged.push(tag)
    this.setTags(itemId, merged)
  }

  tagCounts(limit = 100): TagCountDto[] {
    return this.db
      .prepare(
        `SELECT tag, COUNT(*) AS count FROM item_tags
         GROUP BY tag ORDER BY count DESC, tag ASC LIMIT ?`,
      )
      .all(limit) as unknown as TagCountDto[]
  }

  // ————— reactions —————

  reactionsOf(itemId: number): Record<string, number> {
    const rows = this.db
      .prepare("SELECT emoji, count FROM item_reactions WHERE item_id = ? AND count > 0")
      .all(itemId) as unknown as { emoji: string; count: number }[]
    return Object.fromEntries(rows.map((r) => [r.emoji, r.count]))
  }

  react(itemId: number, emoji: string): number {
    this.db
      .prepare(
        `INSERT INTO item_reactions (item_id, emoji, count) VALUES (?, ?, 1)
         ON CONFLICT (item_id, emoji) DO UPDATE SET count = count + 1`,
      )
      .run(itemId, emoji)
    const row = this.db
      .prepare("SELECT count FROM item_reactions WHERE item_id = ? AND emoji = ?")
      .get(itemId, emoji) as { count: number } | undefined
    return row?.count ?? 0
  }

  // ————— DTO assembly —————

  dto(row: ItemRow): ItemDto {
    return itemDto(row, this.tagsOf(row.id), this.reactionsOf(row.id))
  }

  /** one grouped query per side table for the whole page — never N+1 */
  dtos(rows: ItemRow[]): ItemDto[] {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    const holes = ids.map(() => "?").join(",")
    const tags = new Map<number, string[]>()
    for (const r of this.db
      .prepare(`SELECT item_id, tag FROM item_tags WHERE item_id IN (${holes}) ORDER BY tag`)
      .all(...ids) as unknown as { item_id: number; tag: string }[]) {
      const list = tags.get(r.item_id)
      if (list) list.push(r.tag)
      else tags.set(r.item_id, [r.tag])
    }
    const reactions = new Map<number, Record<string, number>>()
    for (const r of this.db
      .prepare(
        `SELECT item_id, emoji, count FROM item_reactions
         WHERE item_id IN (${holes}) AND count > 0`,
      )
      .all(...ids) as unknown as { item_id: number; emoji: string; count: number }[]) {
      const map = reactions.get(r.item_id) ?? {}
      map[r.emoji] = r.count
      reactions.set(r.item_id, map)
    }
    return rows.map((row) => itemDto(row, tags.get(row.id) ?? [], reactions.get(row.id) ?? {}))
  }

  // ————— templates —————

  templateById(id: string): TemplateRow | undefined {
    return this.db.prepare("SELECT * FROM templates WHERE id = ?").get(id) as
      | TemplateRow
      | undefined
  }

  listTemplates(): TemplateRow[] {
    return this.db
      .prepare("SELECT * FROM templates ORDER BY name COLLATE NOCASE")
      .all() as unknown as TemplateRow[]
  }

  createTemplate(input: {
    id: string
    name: string
    source: TemplateSource
    ext: string
    width: number
    height: number
    zones: Zone[]
    data: Buffer
    /** upstream page, for the attribution line */
    sourceUrl?: string | null
    /** upstream id, so a re-import can recognise its own work */
    sourceRef?: string | null
  }): TemplateRow {
    let id = input.id
    for (let n = 2; this.templateById(id); n++) id = `${input.id}-${n}`
    const file = this.templatePath(id, input.ext)
    fs.writeFileSync(file, input.data)
    try {
      this.db
        .prepare(
          `INSERT INTO templates (id, name, source, ext, width, height, zones_json, created_at, source_url, source_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.source,
          input.ext,
          input.width,
          input.height,
          JSON.stringify(input.zones),
          Date.now(),
          input.sourceUrl ?? null,
          input.sourceRef ?? null,
        )
    } catch (err) {
      // no row will ever reference this blob — don't leave it orphaned on disk
      fs.rmSync(file, { force: true })
      throw err
    }
    return this.templateById(id)!
  }

  /** Fill in attribution for a row imported before v3 knew where it came from.
   *  Only ever writes over NULLs — an existing attribution is never rewritten. */
  backfillTemplateSource(id: string, sourceUrl: string, sourceRef: string): boolean {
    const changes = this.db
      .prepare(
        `UPDATE templates SET source_url = ?, source_ref = ?
         WHERE id = ? AND source_url IS NULL AND source_ref IS NULL`,
      )
      .run(sourceUrl, sourceRef, id).changes
    return Number(changes) > 0
  }

  /** Rename a template in place. The id is both the primary key and the
   *  filename, so it never moves — only the label the picker shows and
   *  searches on. */
  renameTemplate(id: string, name: string): boolean {
    const changes = this.db
      .prepare("UPDATE templates SET name = ? WHERE id = ?")
      .run(name, id).changes
    return Number(changes) > 0
  }

  /** Replace a template's caption boxes. The picture and the id are untouched;
   *  only where the text sits changes, which is what the curated layouts in
   *  scripts/layouts/ are applied with. */
  setTemplateZones(id: string, zones: Zone[]): boolean {
    const changes = this.db
      .prepare("UPDATE templates SET zones_json = ? WHERE id = ?")
      .run(JSON.stringify(zones), id).changes
    return Number(changes) > 0
  }

  /** How many items were forged from a template — what repointItems would
   *  move, without moving it. */
  countItemsForTemplate(templateId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM items WHERE template_id = ?")
      .get(templateId) as unknown as { count: number }
    return Number(row.count)
  }

  /** Move every item filed under one template to another. The FK is ON DELETE
   *  SET NULL, so merging two duplicate templates has to repoint first or the
   *  items quietly lose their "remix this template" link. */
  repointItems(fromTemplateId: string, toTemplateId: string): number {
    const changes = this.db
      .prepare("UPDATE items SET template_id = ? WHERE template_id = ?")
      .run(toTemplateId, fromTemplateId).changes
    return Number(changes)
  }

  deleteTemplate(id: string): boolean {
    const row = this.templateById(id)
    if (!row) return false
    this.db.prepare("DELETE FROM templates WHERE id = ?").run(id)
    fs.rmSync(this.templatePath(row.id, row.ext), { force: true })
    return true
  }
}
