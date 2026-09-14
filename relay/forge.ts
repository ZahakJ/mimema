/**
 * The relay's pipe: chat context → headless `claude -p` running the repo's
 * /meme skill → Mimema's own browser render path → POST /api/items.
 *
 * Mimema itself has no AI. Everything model-shaped in this project lives in
 * relay/, and this file is the only place that shells out to `claude`.
 */
import { spawn } from "node:child_process"
import path from "node:path"
import { z } from "zod"
import type { Browser } from "playwright"
import type { TemplateDto, ItemDto } from "../shared/schema.ts"

export const REPO_ROOT = path.join(import.meta.dirname, "..")
export const CLAUDE_TIMEOUT_MS = 180_000
/** anyone in the room can trigger a forge, so the default is the cheap model; MEME_RELAY_MODEL overrides */
export const DEFAULT_MODEL = "sonnet"
export const DOC_READY_TIMEOUT_MS = 30_000

/** what /meme --json promises (see .claude/skills/meme/SKILL.md) */
export const pickSchema = z.object({
  templateId: z.string().min(1),
  captions: z.array(z.string()),
  title: z.string(),
  alt: z.string().nullable(),
})
export type Pick = z.infer<typeof pickSchema>

export type ForgeResult = {
  slug: string
  /** absolute: the raw PNG */
  url: string
  /** absolute: the OG share page */
  shareUrl: string
  templateId: string
  captions: string[]
  title: string
  pngBytes: Buffer
}

/** what the picker may touch; the news desk adds WebSearch/WebFetch to it */
export const PICKER_TOOLS = ["Bash(curl:*)", "Bash(python3:*)", "Read"]

/** injectable so forge() is testable without spending a model call */
export type ClaudeRunner = (args: {
  prompt: string
  cwd: string
  timeoutMs: number
  model?: string | undefined
  /** --allowedTools; defaults to PICKER_TOOLS */
  allowedTools?: string[] | undefined
}) => Promise<string>

export type ForgeOpts = {
  runner?: ClaudeRunner
  /** where the Mimema API lives (default MEME_ORIGIN or http://127.0.0.1:8001) */
  origin?: string
  /** only used to absolutize the relative url/shareUrl the API returns */
  publicOrigin?: string
  inviteKey?: string
  model?: string | undefined
  /** extra tags beyond "relay", e.g. the caller's "discord" */
  tags?: string[]
  timeoutMs?: number
}

export function origin(opts: ForgeOpts = {}): string {
  return (opts.origin ?? process.env.MEME_ORIGIN ?? "http://127.0.0.1:8001").replace(/\/+$/, "")
}

export function publicOrigin(opts: ForgeOpts = {}): string {
  return (
    opts.publicOrigin ??
    process.env.MEME_PUBLIC_ORIGIN ??
    "https://meme.avicenna.space"
  ).replace(/\/+$/, "")
}

// ————— step 1: ask the picker —————

/**
 * Pull the JSON object out of a model result: the skill promises a bare
 * object, but a fenced block or a sentence of preamble is the cheapest thing
 * in the world to tolerate.
 */
export function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const candidates = [fenced?.[1], raw].filter((s): s is string => typeof s === "string")
  for (const candidate of candidates) {
    const slice = firstObject(candidate)
    if (slice === null) continue
    try {
      return JSON.parse(slice)
    } catch {
      // fall through to the next candidate
    }
  }
  throw new Error(`no JSON object in the picker's answer: ${raw.slice(0, 300)}`)
}

/** first balanced {...}, ignoring braces inside strings */
function firstObject(text: string): string | null {
  const start = text.indexOf("{")
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

export function parsePick(raw: string): Pick {
  const parsed = pickSchema.safeParse(extractJson(raw))
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    throw new Error(`the picker's JSON does not match the contract — ${why}`)
  }
  return parsed.data
}

/**
 * `claude -p "/meme --json <path>"`. The slash form is what loads the project
 * skill, so cwd MUST be the repo root. --permission-prompts none turns
 * anything outside --allowedTools into an instant denial instead of a hang.
 */
export const runClaude: ClaudeRunner = ({ prompt, cwd, timeoutMs, model, allowedTools }) => {
  const argv = ["-p", prompt, "--output-format", "json", "--permission-prompts", "none"]
  if (model) argv.push("--model", model)
  argv.push("--allowedTools", ...(allowedTools ?? PICKER_TOOLS))

  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", argv, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
    }, timeoutMs)

    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (err += d))
    child.on("error", (e) => {
      clearTimeout(timer)
      reject(new Error(`could not run \`claude\`: ${e.message}`))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new Error(`claude timed out after ${timeoutMs}ms`))
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.trim().slice(0, 500)}`))
      let envelope: { result?: unknown; is_error?: unknown }
      try {
        envelope = JSON.parse(out)
      } catch {
        return reject(new Error(`claude did not return JSON: ${out.slice(0, 300)}`))
      }
      if (envelope.is_error) {
        return reject(new Error(`claude reported an error: ${String(envelope.result).slice(0, 300)}`))
      }
      if (typeof envelope.result !== "string") {
        return reject(new Error("claude returned no result field"))
      }
      resolve(envelope.result)
    })
  })
}

/** step 1a on its own — the cheap half, what `--dry-run` stops at */
export async function pickMeme(contextPath: string, opts: ForgeOpts = {}): Promise<Pick> {
  const runner = opts.runner ?? runClaude
  const raw = await runner({
    prompt: `/meme --json ${contextPath}`,
    cwd: REPO_ROOT,
    timeoutMs: opts.timeoutMs ?? CLAUDE_TIMEOUT_MS,
    model: opts.model ?? process.env.MEME_RELAY_MODEL ?? DEFAULT_MODEL,
  })
  return parsePick(raw)
}

// ————— step 2: the template has to exist —————

export async function fetchTemplate(id: string, opts: ForgeOpts = {}): Promise<TemplateDto> {
  const res = await fetch(`${origin(opts)}/api/templates/${encodeURIComponent(id)}`)
  if (res.status === 404) throw new Error(`picked a template that doesn't exist: ${id}`)
  if (!res.ok) throw new Error(`template lookup failed: ${res.status}`)
  return (await res.json()) as TemplateDto
}

/** one caption per zone, in zone order: trim the overflow, pad the shortfall */
export function fitCaptions(captions: string[], zoneCount: number): string[] {
  const fitted = captions.slice(0, zoneCount)
  while (fitted.length < zoneCount) fitted.push("")
  return fitted
}

// ————— step 3: render through the app itself —————

export function editUrl(base: string, templateId: string, captions: string[], title: string): string {
  const params = new URLSearchParams()
  for (const c of captions) params.append("c", c)
  if (title) params.set("title", title)
  // URLSearchParams spells a space `+`; %20 decodes right under both
  // URLSearchParams and a hand-rolled decodeURIComponent on the client side
  const query = params.toString().replace(/\+/g, "%20")
  return `${base}/#/edit/${encodeURIComponent(templateId)}?${query}`
}

export function dataUrlToBuffer(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
  if (!m || !m[1]) throw new Error(`exportPng() did not return a PNG data URL (got ${dataUrl.slice(0, 60)}…)`)
  const buf = Buffer.from(m[1].replace(/\s+/g, ""), "base64")
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("decoded export is not a PNG")
  return buf
}

let browserPromise: Promise<Browser> | null = null

/** one chromium for the life of the process; the bot renders all day */
export async function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import("playwright").then((pw) => pw.chromium.launch())
    process.once("SIGTERM", () => void closeBrowser())
    process.once("SIGINT", () => void closeBrowser())
  }
  return browserPromise
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise
  browserPromise = null
  if (!pending) return
  try {
    await (await pending).close()
  } catch {
    // shutting down anyway
  }
}

/**
 * renderMeme is the app's only render path (preview and export both go through
 * it) — so the relay renders by driving the real page rather than
 * reimplementing the canvas math and slowly drifting from it.
 */
export async function renderInBrowser(
  templateId: string,
  captions: string[],
  title: string,
  opts: ForgeOpts = {},
): Promise<Buffer> {
  const page = await (await browser()).newPage({ viewport: { width: 1440, height: 900 } })
  const problems: string[] = []
  page.on("pageerror", (e) => problems.push(e.message))
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(msg.text())
  })
  try {
    await page.goto(editUrl(origin(opts), templateId, captions, title), { waitUntil: "domcontentloaded" })
    try {
      await page.waitForSelector(`body[data-doc-ready=${JSON.stringify(templateId)}]`, {
        timeout: DOC_READY_TIMEOUT_MS,
      })
    } catch {
      throw new Error(
        `the forge never signalled data-doc-ready="${templateId}"` +
          (problems.length ? ` — page errors: ${problems.slice(0, 3).join(" | ")}` : ""),
      )
    }
    const dataUrl = await page.evaluate(
      () => (window as unknown as { __mimema: { exportPng(): Promise<string> } }).__mimema.exportPng(),
    )
    return dataUrlToBuffer(dataUrl)
  } finally {
    await page.close().catch(() => undefined)
  }
}

// ————— step 4: ship it to the wall —————

export async function postItem(
  png: Buffer,
  meta: { title: string; templateId: string; tags: string[] },
  opts: ForgeOpts = {},
): Promise<ItemDto> {
  const key = opts.inviteKey ?? process.env.INVITE_KEY ?? ""
  if (!key) throw new Error("INVITE_KEY is not set — publishing is disabled")
  const form = new FormData()
  form.set("file", new File([new Uint8Array(png)], `${meta.templateId}.png`, { type: "image/png" }))
  form.set("kind", "meme")
  form.set("title", meta.title)
  form.set("templateId", meta.templateId)
  form.set("tags", meta.tags.join(","))
  const res = await fetch(`${origin(opts)}/api/items`, {
    method: "POST",
    body: form,
    headers: { "x-meme-key": key },
  })
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`posting to the wall failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  return (await res.json()) as ItemDto
}

function absolutize(url: string, base: string): string {
  return /^https?:\/\//i.test(url) ? url : `${base}${url}`
}

/**
 * Everything after the pick: look the template up, fit the captions, render
 * through the app, ship it to the wall. Split out from forge() so the news
 * digest can reuse the expensive half with picks that came from a different
 * skill — there must stay exactly one render-and-publish path.
 */
export async function forgePick(pick: Pick, opts: ForgeOpts = {}): Promise<ForgeResult> {
  const template = await fetchTemplate(pick.templateId, opts)
  const captions = fitCaptions(pick.captions, template.zones.length)
  const png = await renderInBrowser(pick.templateId, captions, pick.title, opts)
  const tags = ["relay", ...(opts.tags ?? [])]
  const item = await postItem(png, { title: pick.title, templateId: pick.templateId, tags }, opts)
  const base = publicOrigin(opts)
  return {
    slug: item.slug,
    url: absolutize(item.url, base),
    shareUrl: absolutize(item.shareUrl, base),
    templateId: pick.templateId,
    captions,
    title: pick.title,
    pngBytes: png,
  }
}

/** the whole pipe */
export async function forge(contextPath: string, opts: ForgeOpts = {}): Promise<ForgeResult> {
  return forgePick(await pickMeme(contextPath, opts), opts)
}
