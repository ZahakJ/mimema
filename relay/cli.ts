#!/usr/bin/env node
/**
 * node --env-file-if-exists=.env relay/cli.ts <context.txt> [--dry-run]
 * node --env-file-if-exists=.env relay/cli.ts --digest [--count N] [--dry-run]
 *
 * The whole pipe on one file of chat, printed as JSON. --dry-run stops after
 * the picker — no browser, no wall, no INVITE_KEY — which makes it the cheap
 * end-to-end test of the AI half. --digest runs the news desk instead: today's
 * stories, each with a forum post and a meme.
 */
import path from "node:path"
import { closeBrowser, forge, pickMeme } from "./forge.ts"
import { digest, pickNews } from "./digest.ts"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const isDigest = args.includes("--digest")

function flag(name: string): string | undefined {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

async function main(): Promise<void> {
  if (isDigest) {
    const raw = flag("--count")
    const count = raw === undefined ? undefined : Number(raw)
    if (count !== undefined && !Number.isFinite(count)) {
      console.error("usage: relay/cli.ts --digest [--count N] [--dry-run]")
      process.exit(2)
    }
    const opts = count === undefined ? {} : { count }
    if (dryRun) {
      console.log(JSON.stringify({ items: await pickNews(opts) }, null, 2))
    } else {
      console.log(JSON.stringify(await digest({ ...opts, source: "cli" }), null, 2))
    }
    return
  }

  const file = args.find((a) => !a.startsWith("--") && a !== flag("--count"))
  if (!file) {
    console.error("usage: relay/cli.ts <context.txt> [--dry-run]  |  relay/cli.ts --digest [--count N] [--dry-run]")
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
