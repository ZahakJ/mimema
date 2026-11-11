/**
 * The news desk: a headless `claude -p` following the repo's /meme-news skill
 * searches today's stories, picks the meme-able ones, and hands back a forum
 * post (title + blurb + source) plus a template pick for each. Every pick then
 * goes through the ordinary forge pipeline — `forgePick()` — so a digest meme
 * and a hand-made one still come out of the same `renderMeme`.
 *
 * Partial success is the normal case: one story failing to render must not
 * cost the caller the other two.
 *
 * The desk reads the open web, so it is the most exposed model run here: it
 * gets web search and fetch and nothing else — no shell, no file access. The
 * catalog, the exclude list, the taste brief and the redo notes are fenced
 * into its prompt by this process.
 */
import { z } from "zod"
import { JOKE_SHAPES, loadMeanings } from "../scripts/meanings.ts"
import {
  MAX_CAPTION_CHARS,
  TEMPLATE_ID_RE,
  UNTRUSTED_NOTE,
  extractJson,
  fence,
  loadCatalog,
  nonce,
  forgePick as realForgePick,
  runClaude,
  skillText,
  type ClaudeRunner,
  type ForgeOpts,
  type ForgeResult,
  type Pick,
} from "./forge.ts"

/** searching the web and reading a few articles takes minutes, not seconds */
export const DIGEST_TIMEOUT_MS = 300_000
export const DEFAULT_COUNT = 2
export const MAX_COUNT = 4
/** model for /digest; MEME_NEWS_MODEL overrides, MEME_RELAY_MODEL does not apply */
export const DEFAULT_NEWS_MODEL = "opus"
/** reading the news needs the web and nothing else */
export const NEWS_TOOLS: readonly string[] = ["WebSearch", "WebFetch"]
/** the exclude list is the caller's memory; it is capped like the rest of the taste */
export const MAX_EXCLUDE = 200
export const MAX_EXCLUDE_CHARS = 300

export const TOPICS = ["tech", "internet", "sports", "culture", "world", "science"] as const
export type Topic = (typeof TOPICS)[number]

/** the taste fields of /digest: a standing brief plus reactions */
export const MAX_INTERESTS_CHARS = 500
export const MAX_FEEDBACK = 60
export const MAX_FEEDBACK_TITLE = 200
/** a topic in feedback is whatever the caller stored; it is one short token or it is "?" */
const MAX_FEEDBACK_TOPIC = 32

/** one earlier post and how the room reacted to it (👍 / 👎 on the forum thread) */
export type Feedback = { title: string; topic: string; up: number; down: number }

/** a `why` shorter than this is not a justification, it is a shrug */
export const MIN_WHY_CHARS = 20

/** what /meme-news --json promises (see .claude/skills/meme-news/SKILL.md) */
export const digestPickSchema = z.strictObject({
  title: z.string().min(1).max(200),
  blurb: z.string().min(1).max(1_000),
  // a well-formed http(s) URL is all zod can check; whether it is a *real* one
  // is the skill's problem, and its Don'ts say so in as many words
  sourceUrl: z
    .string()
    .max(2_000)
    .url()
    .regex(/^https?:\/\//i, "an http(s) URL"),
  topic: z.enum(TOPICS),
  templateId: z.string().regex(TEMPLATE_ID_RE, "a template id is a lowercase slug"),
  captions: z.array(z.string().max(MAX_CAPTION_CHARS)).max(8),
  // shape and why are the desk's working, checked by vetPicks() and dropped
  // from DigestItem
  shape: z.enum(JOKE_SHAPES),
  why: z.string().min(MIN_WHY_CHARS).max(1_000),
})
export type DigestPick = z.infer<typeof digestPickSchema>

export const digestSchema = z.strictObject({ items: z.array(digestPickSchema).max(10) })

/** what the caller gets: the post, without the desk's working */
export type DigestItem = Omit<DigestPick, "shape" | "why"> & {
  slug: string
  url: string
  shareUrl: string
}

export type DigestResult = { items: DigestItem[]; errors: string[] }

export type DigestOpts = {
  count?: number
  /** titles/URLs already posted recently — the caller keeps that memory */
  exclude?: string[]
  /** the standing brief: what the room wants to see more of (≤ 500 chars) */
  interests?: string | null
  /** reactions to earlier posts — the audience talking back (≤ 60 entries) */
  feedback?: Feedback[]
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
  /** the catalog text, already built; injected by the tests so they never touch the API */
  catalog?: string
  /** injected by the tests so they never touch a browser or the wall */
  forgePick?: (pick: Pick, opts?: ForgeOpts) => Promise<ForgeResult>
}

/**
 * The desk's diagnostics, on **stderr**: journalctl keeps both streams, and
 * relay/cli.ts prints the digest as JSON on stdout — a stray log line there
 * would make its output unparseable.
 */
function note(line: string): void {
  console.error(`[relay] digest ${line}`)
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

const oneLineText = (s: string) => s.replace(/\s+/g, " ").trim()

/** trimmed to the cap, or null when there is nothing to say */
export function cleanInterests(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const text = oneLineText(raw)
  if (text === "") return null
  return text.length > MAX_INTERESTS_CHARS ? text.slice(0, MAX_INTERESTS_CHARS - 1).trimEnd() + "…" : text
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0

/**
 * Drops what does not fit the contract instead of refusing the whole digest:
 * one odd entry in a bot's memory must not cost the room its news. Keeps the
 * first MAX_FEEDBACK survivors in the order given, and caps every title.
 */
export function cleanFeedback(raw: unknown[]): Feedback[] {
  const out: Feedback[] = []
  for (const entry of raw) {
    if (out.length >= MAX_FEEDBACK) break
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue
    const { title, topic, up, down } = entry as Record<string, unknown>
    if (typeof title !== "string" || typeof topic !== "string" || !isCount(up) || !isCount(down)) continue
    let t = oneLineText(title)
    if (t === "") continue
    if (t.length > MAX_FEEDBACK_TITLE) t = t.slice(0, MAX_FEEDBACK_TITLE - 1).trimEnd() + "…"
    out.push({ title: t, topic: oneLineText(topic).slice(0, MAX_FEEDBACK_TOPIC) || "?", up, down })
  }
  return out
}

/**
 * The taste brief the news desk reads before it picks: the standing brief and
 * the reactions to earlier posts, best-received first. Pure, so the shape is
 * testable without a model. The skill treats it as a prior, not
 * a rule — see .claude/skills/meme-news/SKILL.md.
 */
export function tasteFile(interests: string | null | undefined, feedback: Feedback[] = []): string {
  const brief = cleanInterests(interests) ?? "(none stated)"
  const entries = cleanFeedback(feedback).sort((a, b) => b.up - b.down - (a.up - a.down))
  const width = Math.max(0, ...entries.map((e) => e.topic.length + 2))
  const lines =
    entries.length === 0
      ? ["(none yet)"]
      : entries.map((e) => `- 👍 ${e.up}  👎 ${e.down}  ${`[${e.topic}]`.padEnd(width)}  ${e.title}`)
  return ["# Interests", brief, "", "# Reactions to earlier posts (👍 / 👎)", ...lines, ""].join("\n")
}

// ————— the relevance check: model-free, cheap, and deliberately lenient —————

/**
 * Words that are capitalised because a sentence started, not because they name
 * anything. Everything else capitalised in a headline is treated as the story's
 * own noun — headlines are Title Case often enough that this stays generous,
 * which is the point: this is a floor under the captions, not a taste test.
 */
const NOT_A_NAME = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "did", "do", "does", "for", "from",
  "had", "has", "have", "how", "in", "into", "is", "it", "its", "new", "no", "not", "of", "off",
  "on", "one", "or", "out", "over", "per", "said", "says", "so", "than", "that", "the", "their",
  "them", "then", "they", "this", "to", "up", "was", "were", "what", "when", "which", "who", "why",
  "will", "with", "you", "your", "after", "again", "all", "also", "now", "just", "more", "most",
  "report", "reports", "reported", "according", "week", "year", "day", "today", "yesterday",
])

/** fold plurals and possessives so "Bungie's" in the title matches "Bungie" in a caption */
function stem(token: string): string {
  const t = token.replace(/['’]s$/u, "")
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t
}

/**
 * The tokens that make a story *this* story: the names, the numbers, the
 * products. A capitalised word or anything containing a digit counts; the
 * stopwords above do not. Exported because the test tunes it against the real
 * headlines the desk produced.
 */
export function storyTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.split(/[^\p{L}\p{N}'’$%.-]+/u)) {
    const token = raw.replace(/^[.'’$%-]+|[.'’,$%-]+$/gu, "")
    if (token.length < 2) continue
    const lower = stem(token.toLowerCase())
    if (lower.length < 2) continue
    if (/\p{N}/u.test(token)) {
      out.add(lower)
      continue
    }
    if (token.length < 3 || NOT_A_NAME.has(lower)) continue
    if (/\p{Lu}/u.test(token)) out.add(lower)
  }
  return out
}

/** every token in the captions, held to the same stemming as the story's */
function captionTokens(captions: string[]): Set<string> {
  const out = new Set<string>()
  for (const raw of captions.join(" ").split(/[^\p{L}\p{N}'’$%.-]+/u)) {
    const token = raw.replace(/^[.'’$%-]+|[.'’,$%-]+$/gu, "")
    if (token.length < 2) continue
    out.add(stem(token.toLowerCase()))
  }
  return out
}

/** a pick the desk has to try again, and the sentence it is told why */
export type Rejection = { pick: DigestPick; why: string }

/**
 * The house check on a batch of picks. No model, no network: everything here is
 * decidable from the pick itself plus scripts/meanings.json.
 *
 * It is a floor, not a critic. It cannot tell a funny caption from a flat one —
 * what it catches is a meme that isn't about this story (captions sharing not
 * one name or number with the headline), a template that cannot hold the joke
 * the desk says it is telling, and a digest that is the same joke twice. Tuned
 * against the digests actually posted in September: none of them trips rule 1,
 * which is the intended strictness — a good joke that paraphrases still passes.
 */
export function vetPicks(picks: DigestPick[]): { kept: DigestPick[]; rejected: Rejection[] } {
  const meanings = loadMeanings()
  const kept: DigestPick[] = []
  const rejected: Rejection[] = []
  const usedTemplates = new Set<string>()
  const usedTopics = new Set<string>()

  for (const pick of picks) {
    const story = storyTokens(`${pick.title} ${pick.blurb}`)
    const written = captionTokens(pick.captions)
    const shared = [...story].filter((t) => written.has(t))
    const meaning = meanings[pick.templateId]

    let why: string | null = null
    if (shared.length === 0) {
      why =
        "the captions share not one name, number or product with the story — write the joke about " +
        `this story, using its own nouns (${[...story].slice(0, 4).join(", ") || "the headline's names"})`
    } else if (meaning && !meaning.shapes.includes(pick.shape)) {
      why =
        `${pick.templateId} cannot carry a "${pick.shape}" joke — it says: ${meaning.says}. ` +
        `Pick a template whose picture makes a ${pick.shape} point, or restate the story's shape honestly.`
    } else if (usedTemplates.has(pick.templateId)) {
      why = `${pick.templateId} is already used by another story in this digest — one joke told twice`
    } else if (usedTopics.has(pick.topic)) {
      why = `another story in this digest is already "${pick.topic}" — spread the digest across topics`
    }

    if (why === null) {
      usedTemplates.add(pick.templateId)
      usedTopics.add(pick.topic)
      kept.push(pick)
    } else {
      rejected.push({ pick, why })
    }
  }
  return { kept, rejected }
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

/** trimmed, one line each, capped in count and length */
export function cleanExclude(raw: string[]): string[] {
  return raw
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, MAX_EXCLUDE_CHARS))
    .filter((s) => s !== "")
    .slice(0, MAX_EXCLUDE)
}

/**
 * The desk's user turn: the arguments, today's date, the catalog, then each
 * piece of caller- or model-derived text in its own fenced block. The skill
 * reads `--exclude`, `--taste` and `--redo` as "the block of that name".
 */
export function newsPrompt(
  args: { count: number; catalog: string; exclude: string[]; taste: string | null; redo: string | null; today: string },
  tag: string = nonce(),
): string {
  let flags = `--json --count ${args.count}`
  if (args.exclude.length > 0) flags += " --exclude"
  if (args.taste !== null) flags += " --taste"
  if (args.redo !== null) flags += " --redo"
  const parts = [
    `Arguments: ${flags}`,
    `date: ${args.today}`,
    "",
    "Relay mode: your only tools are WebSearch and WebFetch. The catalog and the inputs named by the " +
      "flags are below; answer with the JSON object only.",
    UNTRUSTED_NOTE,
    "",
    fence("CATALOG", args.catalog, tag),
  ]
  if (args.exclude.length > 0) parts.push("", fence("EXCLUDE", args.exclude.join("\n"), tag))
  if (args.taste !== null) parts.push("", fence("TASTE", args.taste, tag))
  if (args.redo !== null) parts.push("", fence("REDO", args.redo, tag))
  return parts.join("\n")
}

/**
 * The cheap half: search + pick, no browser and no INVITE_KEY. `--dry-run`
 * stops here.
 */
export async function pickNews(opts: DigestOpts = {}, deps: DigestDeps = {}): Promise<DigestPick[]> {
  const runner = deps.runner ?? runClaude
  const count = clampCount(opts.count)
  const exclude = cleanExclude(opts.exclude ?? [])
  const interests = cleanInterests(opts.interests)
  const feedback = cleanFeedback(opts.feedback ?? [])
  const taste = interests !== null || feedback.length > 0 ? tasteFile(interests, feedback) : null
  const catalog = deps.catalog ?? (await loadCatalog(opts.forgeOpts))
  const today = new Date().toISOString().slice(0, 10)

  const ask = (n: number, redo: string | null = null): Promise<string> =>
    runner({
      system: skillText("meme-news"),
      prompt: newsPrompt({ count: n, catalog, exclude, taste, redo, today }),
      timeoutMs: opts.timeoutMs ?? DIGEST_TIMEOUT_MS,
      model: opts.model ?? process.env.MEME_NEWS_MODEL ?? DEFAULT_NEWS_MODEL,
      tools: NEWS_TOOLS,
    })

  /** parse + vet in one, turning a malformed answer into a reason rather than a throw */
  const round = (raw: string, n: number, sofar: DigestPick[]) => {
    try {
      const vetted = vetPicks([...sofar, ...parseDigest(raw, sofar.length + n)])
      return { kept: vetted.kept, reasons: vetted.rejected, fatal: null as string | null }
    } catch (err) {
      return { kept: sofar, reasons: [] as Rejection[], fatal: oneLine(err) }
    }
  }

  const first = round(await ask(count), count, [])
  let kept = first.kept
  const spare = first.reasons.map((r) => r.pick)
  for (const r of first.reasons) note(`rejected "${r.pick.title}" — ${r.why}`)
  if (first.fatal) note(`first pass unusable — ${first.fatal}`)

  // Exactly one re-ask, never two: the digest is already minutes long, and a
  // desk that missed twice is not going to find it on the third try.
  if (kept.length < count) {
    const missing = count - kept.length
    const second = round(await ask(missing, redoFile(first.fatal, first.reasons, kept)), missing, kept)
    for (const r of second.reasons) note(`rejected (redo) "${r.pick.title}" — ${r.why}`)
    if (second.fatal) note(`redo unusable — ${second.fatal}`)
    kept = second.kept
    spare.push(...second.reasons.map((r) => r.pick))
  }

  if (kept.length > 0) return kept.slice(0, count)
  // Nothing passed twice over. A flawed meme still beats a silent morning, so
  // the rejects ship with the reason in the journal — but only as a last resort.
  if (spare.length > 0) {
    note(`shipping ${Math.min(spare.length, count)} unvetted pick(s) — nothing passed`)
    return spare.slice(0, count)
  }
  throw new Error(first.fatal ?? "the news desk found no stories worth memeing")
}

/**
 * What the desk is handed on the one re-ask: what it got wrong, in its own
 * titles, and what is already taken. Its own fenced block in the prompt: the
 * titles came from the web.
 */
export function redoFile(fatal: string | null, rejected: Rejection[], kept: DigestPick[]): string {
  const lines = [
    "# Redo",
    "",
    "The picks below were refused by the relay's check. Find different stories,",
    "or the same story told with a template that actually carries the joke.",
    "Name the joke shape first, then the template. Do not repeat a title listed here.",
    "",
  ]
  if (fatal) lines.push("## The whole answer was unusable", "", `- ${fatal}`, "")
  if (rejected.length > 0) {
    lines.push("## Refused", "")
    for (const r of rejected) lines.push(`- "${r.pick.title}" (${r.pick.templateId}) — ${r.why}`)
    lines.push("")
  }
  if (kept.length > 0) {
    lines.push("## Already in this digest — different topic and template, please", "")
    for (const k of kept) lines.push(`- "${k.title}" [${k.topic}] (${k.templateId})`)
    lines.push("")
  }
  return lines.join("\n")
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
    // the desk's working goes to the journal, not the response
    const { shape, why, ...post } = pick
    note(`pick [${pick.topic}/${shape}] ${pick.templateId} — ${pick.title} — ${why}`)
    try {
      const forged = await forgeOne(
        { templateId: pick.templateId, captions: pick.captions, title: pick.title, alt: null },
        { ...opts.forgeOpts, tags },
      )
      items.push({
        ...post,
        captions: forged.captions,
        slug: forged.slug,
        url: forged.url,
        shareUrl: forged.shareUrl,
      })
    } catch (err) {
      // the caller gets the short form; the journal gets all of it, on one line
      note(`failed "${pick.title}": ${(err instanceof Error ? err.message : String(err)).replace(/\s*\n\s*/g, " | ")}`)
      errors.push(`${pick.title}: ${oneLine(err)}`)
    }
  }
  return { items, errors }
}
