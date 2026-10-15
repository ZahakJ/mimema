#!/usr/bin/env node
/**
 * node --env-file-if-exists=.env relay/cli.ts <context.txt> [--dry-run]
 * node --env-file-if-exists=.env relay/cli.ts --digest [--count N] [--dry-run]
 *     [--interests "<text>"] [--feedback <file.json>]
 *
 * The whole pipe on one file of chat, printed as JSON. --dry-run stops after
 * the picker: no browser, no wall, no INVITE_KEY. --digest runs the news desk
 * instead. --interests and --feedback are the /digest taste fields: a standing
 * brief, and a JSON array of `{title, topic, up, down}` reactions.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { closeBrowser, forge, pickMeme } from "./forge.ts"
import { cleanFeedback, digest, pickNews, type DigestOpts } from "./digest.ts"

const USAGE =
  "usage: relay/cli.ts <context.txt> [--dry-run]  |  relay/cli.ts --digest [--count N] [--dry-run]" +
  ' [--interests "<text>"] [--feedback <file.json>]'

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const isDigest = args.includes("--digest")
/** flags that take a value; their value is never the context file */
const VALUED = ["--count", "--interests", "--feedback"]

function flag(name: string): string | undefined {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

async function main(): Promise<void> {
  if (isDigest) {
    const raw = flag("--count")
    const count = raw === undefined ? undefined : Number(raw)
    if (count !== undefined && !Number.isFinite(count)) {
      console.error(USAGE)
      process.exit(2)
    }
    const opts: DigestOpts = count === undefined ? {} : { count }
    const interests = flag("--interests")
    if (interests !== undefined) opts.interests = interests
    const feedbackFile = flag("--feedback")
    if (feedbackFile !== undefined) {
      const parsed: unknown = JSON.parse(await readFile(path.resolve(feedbackFile), "utf8"))
      // a bare array, or a whole /digest request body
      const list = Array.isArray(parsed) ? parsed : (parsed as { feedback?: unknown } | null)?.feedback
      if (!Array.isArray(list)) throw new Error(`${feedbackFile}: expected a JSON array of {title, topic, up, down}`)
      opts.feedback = cleanFeedback(list)
    }
    if (dryRun) {
      console.log(JSON.stringify({ items: await pickNews(opts) }, null, 2))
    } else {
      console.log(JSON.stringify(await digest({ ...opts, source: "cli" }), null, 2))
    }
    return
  }

  const values = new Set(VALUED.map(flag).filter((v) => v !== undefined))
  const file = args.find((a) => !a.startsWith("--") && !values.has(a))
  if (!file) {
    console.error(USAGE)
    process.exit(2)
    return
  }
  const contextPath = path.resolve(file)
  if (dryRun) {
    console.log(JSON.stringify(await pickMeme(contextPath), null, 2))
  } else {
    const { pngBytes, ...rest } = await forge(contextPath, { tags: ["cli"] })
    console.log(JSON.stringify({ ...rest, bytes: pngBytes.byteLength }, null, 2))
  }
}

try {
  await main()
} catch (err) {
  console.error(`[relay] ${err instanceof Error ? err.message : String(err)}`)
  await closeBrowser()
  process.exit(1)
}
await closeBrowser()
