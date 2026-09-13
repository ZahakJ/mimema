#!/usr/bin/env node
/**
 * node --env-file-if-exists=.env relay/cli.ts <context.txt> [--dry-run]
 *
 * The whole pipe on one file of chat, printed as JSON. --dry-run stops after
 * the picker — no browser, no wall, no INVITE_KEY — which makes it the cheap
 * end-to-end test of the AI half.
 */
import path from "node:path"
import { closeBrowser, forge, pickMeme } from "./forge.ts"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const file = args.find((a) => !a.startsWith("--"))

if (!file) {
  console.error("usage: relay/cli.ts <context.txt> [--dry-run]")
  process.exit(2)
}

const contextPath = path.resolve(file)

try {
  if (dryRun) {
    console.log(JSON.stringify(await pickMeme(contextPath), null, 2))
  } else {
    const { pngBytes, ...rest } = await forge(contextPath, { tags: ["cli"] })
    console.log(JSON.stringify({ ...rest, bytes: pngBytes.byteLength }, null, 2))
  }
} catch (err) {
  console.error(`[relay] ${err instanceof Error ? err.message : String(err)}`)
  await closeBrowser()
  process.exit(1)
}
await closeBrowser()
