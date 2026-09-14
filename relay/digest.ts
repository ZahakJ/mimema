/**
 * The news desk: a headless `claude -p` running the repo's /meme-news skill
 * searches today's stories, picks the meme-able ones, and hands back a forum
 * post (title + blurb + source) plus a template pick for each. Every pick then
 * goes through the ordinary forge pipeline — `forgePick()` — so a digest meme
 * and a hand-made one still come out of the same `renderMeme`.
 *
 * Partial success is the normal case: one story failing to render must not
 * cost the caller the other two.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { z } from "zod"
import {
  DEFAULT_MODEL,
  PICKER_TOOLS,
  REPO_ROOT,
  extractJson,
  forgePick as realForgePick,
  runClaude,
  type ClaudeRunner,
  type ForgeOpts,
  type ForgeResult,
  type Pick,
} from "./forge.ts"

/** searching the web and reading a few articles takes minutes, not seconds */
export const DIGEST_TIMEOUT_MS = 300_000
export const DEFAULT_COUNT = 2
export const MAX_COUNT = 4
/** the picker's tools plus the two the news desk actually needs */
export const NEWS_TOOLS = ["WebSearch", "WebFetch", ...PICKER_TOOLS]

export const TOPICS = ["tech", "internet", "sports", "culture", "world", "science"] as const
export type Topic = (typeof TOPICS)[number]

/** what /meme-news --json promises (see .claude/skills/meme-news/SKILL.md) */
export const digestPickSchema = z.object({
  title: z.string().min(1),
  blurb: z.string().min(1),
  // a well-formed URL is all zod can check; whether it is a *real* one is the
  // skill's problem, and its Don'ts say so in as many words
  sourceUrl: z.string().url(),
  topic: z.enum(TOPICS),
  templateId: z.string().min(1),
  captions: z.array(z.string()),
})
export type DigestPick = z.infer<typeof digestPickSchema>

export const digestSchema = z.object({ items: z.array(digestPickSchema) })

export type DigestItem = DigestPick & {
  slug: string
  url: string
  shareUrl: string
}

export type DigestResult = { items: DigestItem[]; errors: string[] }

export type DigestOpts = {
  count?: number
  /** titles/URLs already posted recently — the caller keeps that memory */
  exclude?: string[]
  /** becomes a tag on every wall item, alongside relay/news/<topic> */
  source?: string | null
  model?: string | undefined
  timeoutMs?: number
  /** passed through to forgePick for every item */
  forgeOpts?: ForgeOpts
}

export type DigestDeps = {
  /** injected by the tests so they never touch `claude` */
  runner?: ClaudeRunner
  /** injected by the tests so they never touch a browser or the wall */
  forgePick?: (pick: Pick, opts?: ForgeOpts) => Promise<ForgeResult>
}

export function clampCount(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_COUNT
  return Math.min(MAX_COUNT, Math.max(1, Math.floor(raw)))
}

/** a tag lands on a public wall item, so it is a slug or it is nothing */
export function tagSafe(raw: string): string | null {
  const tag = raw.trim().toLowerCase()
  return /^[a-z0-9-]{1,32}$/.test(tag) ? tag : null
}

export function parseDigest(raw: string, count: number): DigestPick[] {
  const parsed = digestSchema.safeParse(extractJson(raw))
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    throw new Error(`the news desk's JSON does not match the contract — ${why}`)
  }
  if (parsed.data.items.length === 0) throw new Error("the news desk found no stories worth memeing")
  // the skill is asked for N; a model that returns six does not get to post six
  return parsed.data.items.slice(0, count)
}

/**
 * The cheap half: search + pick, no browser and no INVITE_KEY. `--dry-run`
 * stops here. The exclude list goes to a temp file rather than the prompt so a
 * long memory cannot push the instructions out of shape — and it is removed in
 * `finally`, same hygiene as the forge's transcript.
 */
export async function pickNews(opts: DigestOpts = {}, deps: DigestDeps = {}): Promise<DigestPick[]> {
  const runner = deps.runner ?? runClaude
  const count = clampCount(opts.count)
  const exclude = (opts.exclude ?? []).map((s) => s.trim()).filter((s) => s !== "")

  let dir: string | null = null
  try {
    let prompt = `/meme-news --json --count ${count}`
    if (exclude.length > 0) {
      dir = await mkdtemp(path.join(tmpdir(), "mimema-digest-"))
      const excludePath = path.join(dir, "exclude.txt")
      await writeFile(excludePath, exclude.join("\n") + "\n", "utf8")
      prompt += ` --exclude ${excludePath}`
    }
    const raw = await runner({
      prompt,
      cwd: REPO_ROOT,
      timeoutMs: opts.timeoutMs ?? DIGEST_TIMEOUT_MS,
      model: opts.model ?? process.env.MEME_RELAY_MODEL ?? DEFAULT_MODEL,
      allowedTools: NEWS_TOOLS,
    })
    return parseDigest(raw, count)
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function oneLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return (msg.split("\n")[0] ?? "forge failed").slice(0, 200) || "forge failed"
}

/**
 * The whole digest. Throws only when the *pick* fails; after that a story that
 * will not render is one line in `errors` and the rest still ship.
 */
export async function digest(opts: DigestOpts = {}, deps: DigestDeps = {}): Promise<DigestResult> {
  const forgeOne = deps.forgePick ?? realForgePick
  const picks = await pickNews(opts, deps)
  const source = opts.source ? tagSafe(opts.source) : null

  const items: DigestItem[] = []
  const errors: string[] = []
  // serial on purpose: one chromium page and one wall at a time
  for (const pick of picks) {
    const tags = ["news", pick.topic, ...(source ? [source] : []), ...(opts.forgeOpts?.tags ?? [])]
    try {
      const forged = await forgeOne(
        { templateId: pick.templateId, captions: pick.captions, title: pick.title, alt: null },
        { ...opts.forgeOpts, tags },
      )
      items.push({
        ...pick,
        captions: forged.captions,
        slug: forged.slug,
        url: forged.url,
        shareUrl: forged.shareUrl,
      })
    } catch (err) {
      errors.push(`${pick.title}: ${oneLine(err)}`)
    }
  }
  return { items, errors }
}
