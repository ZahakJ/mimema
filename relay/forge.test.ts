import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { TemplateDto } from "../shared/schema.ts"
import type { Browser } from "playwright"
import {
  browser,
  catalogText,
  claudeResult,
  closeBrowser,
  dataUrlToBuffer,
  editUrl,
  extractJson,
  fetchTemplate,
  fitCaptions,
  parsePick,
  pickMeme,
  postItem,
  type ClaudeRunner,
} from "./forge.ts"

const PICK = '{"templateId":"drake","captions":["a","b"],"title":"T","alt":null}'

describe("extractJson", () => {
  it("reads a bare object", () => {
    expect(extractJson(PICK)).toMatchObject({ templateId: "drake" })
  })

  it("reads a ```json fenced block", () => {
    expect(extractJson("```json\n" + PICK + "\n```")).toMatchObject({ templateId: "drake" })
  })

  it("reads an unlabelled fence", () => {
    expect(extractJson("```\n" + PICK + "\n```")).toMatchObject({ templateId: "drake" })
  })

  it("survives prose on both sides", () => {
    const raw = `Here's the pick:\n\n${PICK}\n\nThe structure matches.`
    expect(extractJson(raw)).toMatchObject({ title: "T" })
  })

  it("survives braces inside caption strings", () => {
    const raw = 'sure:\n{"templateId":"x","captions":["{not json}","}"],"title":"a { b","alt":null} — done'
    expect(extractJson(raw)).toMatchObject({ captions: ["{not json}", "}"], title: "a { b" })
  })

  it("survives escaped quotes inside strings", () => {
    const raw = '```json\n{"templateId":"x","captions":["define \\"backups\\""],"title":"t","alt":null}\n```'
    expect(extractJson(raw)).toMatchObject({ captions: ['define "backups"'] })
  })

  it("throws with a readable message when there is no object", () => {
    expect(() => extractJson("I could not find a good template.")).toThrow(/no JSON object/)
    expect(() => extractJson("{not: json at all")).toThrow(/no JSON object/)
  })
})

describe("parsePick", () => {
  it("accepts the contract shape", () => {
    expect(parsePick(PICK)).toEqual({ templateId: "drake", captions: ["a", "b"], title: "T", alt: null })
  })

  it("accepts an alt id", () => {
    expect(parsePick('{"templateId":"x","captions":[],"title":"t","alt":"two-buttons"}').alt).toBe("two-buttons")
  })

  it("rejects a missing templateId", () => {
    expect(() => parsePick('{"captions":["a"],"title":"t","alt":null}')).toThrow(/templateId/)
  })

  it("rejects an empty templateId", () => {
    expect(() => parsePick('{"templateId":"","captions":[],"title":"t","alt":null}')).toThrow(/templateId/)
  })

  it("rejects a missing alt (the skill must be explicit about null)", () => {
    expect(() => parsePick('{"templateId":"x","captions":[],"title":"t"}')).toThrow(/alt/)
  })

  it("rejects non-string captions", () => {
    expect(() => parsePick('{"templateId":"x","captions":[1,2],"title":"t","alt":null}')).toThrow(/captions/)
  })

  it("rejects an unknown key, a non-slug id, and an over-long caption", () => {
    expect(() => parsePick('{"templateId":"x","captions":[],"title":"t","alt":null,"run":"ls"}')).toThrow(/run/)
    expect(() => parsePick('{"templateId":"../etc/passwd","captions":[],"title":"t","alt":null}')).toThrow(
      /templateId/,
    )
    const long = JSON.stringify({ templateId: "x", captions: ["y".repeat(201)], title: "t", alt: null })
    expect(() => parsePick(long)).toThrow(/captions/)
  })
})

describe("fitCaptions", () => {
  it("trims the overflow", () => {
    expect(fitCaptions(["a", "b", "c"], 2)).toEqual(["a", "b"])
  })
  it("pads the shortfall so there is one c per zone", () => {
    expect(fitCaptions(["a"], 3)).toEqual(["a", "", ""])
  })
  it("leaves an exact match alone", () => {
    expect(fitCaptions(["a", "b"], 2)).toEqual(["a", "b"])
  })
})

describe("editUrl", () => {
  it("puts one c per zone after the hash, in order", () => {
    expect(editUrl("http://127.0.0.1:8001", "drake", ["no", "yes"], "T")).toBe(
      "http://127.0.0.1:8001/#/edit/drake?c=no&c=yes&title=T",
    )
  })

  it("percent-encodes spaces as %20, never +", () => {
    const url = editUrl("http://x", "t", ["make it hurt"], "big title")
    expect(url).toContain("c=make%20it%20hurt")
    expect(url).toContain("title=big%20title")
    expect(url).not.toContain("+")
  })

  it("encodes the hostile characters", () => {
    const url = editUrl("http://x", "t", ["a&b=c#d"], "")
    expect(url).toBe("http://x/#/edit/t?c=a%26b%3Dc%23d")
  })

  it("keeps empty zones as empty params", () => {
    expect(editUrl("http://x", "t", ["a", ""], "")).toBe("http://x/#/edit/t?c=a&c=")
  })
})

describe("dataUrlToBuffer", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("body")])

  it("decodes a PNG data URL", () => {
    const out = dataUrlToBuffer(`data:image/png;base64,${png.toString("base64")}`)
    expect(out.equals(png)).toBe(true)
  })

  it("tolerates whitespace in the payload", () => {
    const b64 = png.toString("base64")
    const out = dataUrlToBuffer(`data:image/png;base64,${b64.slice(0, 4)}\n${b64.slice(4)}`)
    expect(out.equals(png)).toBe(true)
  })

  it("rejects a non-PNG data URL", () => {
    expect(() => dataUrlToBuffer("data:image/jpeg;base64,AAAA")).toThrow(/PNG data URL/)
    expect(() => dataUrlToBuffer("blob:http://x/123")).toThrow(/PNG data URL/)
  })

  it("rejects bytes that are not actually a PNG", () => {
    expect(() => dataUrlToBuffer(`data:image/png;base64,${Buffer.from("not a png!").toString("base64")}`)).toThrow(
      /not a PNG/,
    )
  })
})

describe("pickMeme", () => {
  let dir = ""
  let ctx = ""
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mimema-test-"))
    ctx = path.join(dir, "context.txt")
    await writeFile(ctx, "[09:00] dana: ship it", "utf8")
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it("hands the model the meme skill, the catalog and the chat, and no tools", async () => {
    const calls: Parameters<ClaudeRunner>[0][] = []
    const pick = await pickMeme(ctx, {
      model: "sonnet",
      catalog: "drake\t2z\tDrake",
      runner: async (args) => {
        calls.push(args)
        return "```json\n" + PICK + "\n```"
      },
    })
    expect(pick.templateId).toBe("drake")
    expect(calls[0]).toMatchObject({ model: "sonnet", tools: [] })
    expect(calls[0]?.system).toContain("# /meme")
    expect(calls[0]?.system).not.toMatch(/^---/)
    expect(calls[0]?.prompt).toMatch(/^Arguments: --json\n/)
    expect(calls[0]?.prompt).toContain("drake\t2z\tDrake")
    expect(calls[0]?.prompt).toContain("[09:00] dana: ship it")
  })

  it("surfaces a runner failure", async () => {
    await expect(
      pickMeme(ctx, {
        catalog: "",
        runner: async () => {
          throw new Error("claude timed out after 180000ms")
        },
      }),
    ).rejects.toThrow(/timed out/)
  })
})

describe("catalogText", () => {
  const zone = (placeholder: string) => ({ placeholder }) as TemplateDto["zones"][number]
  const t = (id: string, name: string, zones: string[]) => ({ id, name, zones: zones.map(zone) }) as TemplateDto

  it("prints id, zone count, name, real zone roles and the curated meaning", () => {
    const text = catalogText(
      [t("drake", "Drake", ["REJECTED", "APPROVED"]), t("plain", "Plain", ["TOP TEXT", "BOTTOM TEXT"])],
      { drake: { says: "no to one, yes to the other", shapes: ["contrast"] } },
    )
    expect(text.split("\n")).toEqual([
      "drake\t2z\tDrake  [REJECTED | APPROVED]  <contrast> no to one, yes to the other",
      "plain\t2z\tPlain",
    ])
  })

  it("drops a template whose id is not a slug and flattens newlines in names", () => {
    const text = catalogText([t("../x", "bad", ["A"]), t("ok", "two\nlines", ["A"])], {})
    expect(text).toBe("ok\t1z\ttwo lines  [A]")
  })
})

describe("fetchTemplate", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("names the bad id on a 404", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }))
    await expect(fetchTemplate("not-real", { origin: "http://x" })).rejects.toThrow(
      "picked a template that doesn't exist: not-real",
    )
  })

  it("returns the dto and hits /api/templates/:id", async () => {
    const seen: string[] = []
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(String(url))
      return new Response(JSON.stringify({ id: "drake", zones: [{}, {}] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    const tpl = await fetchTemplate("drake", { origin: "http://x/" })
    expect(tpl.zones).toHaveLength(2)
    expect(seen).toEqual(["http://x/api/templates/drake"])
  })
})

describe("postItem", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("refuses to post without an invite key", async () => {
    await expect(
      postItem(Buffer.from("x"), { title: "t", templateId: "d", tags: ["relay"] }, { inviteKey: "" }),
    ).rejects.toThrow(/INVITE_KEY/)
  })

  it("sends the multipart the wall expects, with the key header", async () => {
    let captured: { url: string; init: RequestInit } | null = null
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      captured = { url: String(url), init }
      return new Response(JSON.stringify({ slug: "abc", url: "/m/abc.png", shareUrl: "/m/abc" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    })
    const item = await postItem(
      Buffer.from("x"),
      { title: "Define backups", templateId: "drake", tags: ["relay", "discord"] },
      { origin: "http://x", inviteKey: "k" },
    )
    expect(item.slug).toBe("abc")
    const { url, init } = captured as unknown as { url: string; init: RequestInit }
    expect(url).toBe("http://x/api/items")
    expect((init.headers as Record<string, string>)["x-meme-key"]).toBe("k")
    const form = init.body as FormData
    expect(form.get("kind")).toBe("meme")
    expect(form.get("title")).toBe("Define backups")
    expect(form.get("templateId")).toBe("drake")
    expect(form.get("tags")).toBe("relay,discord")
    expect(form.get("file")).toBeInstanceOf(File)
  })

  it("accepts a dedup hit (200, not 201)", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ slug: "old", url: "/m/old.png", shareUrl: "/m/old", deduped: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    const item = await postItem(Buffer.from("x"), { title: "t", templateId: "d", tags: [] }, { inviteKey: "k" })
    expect(item.slug).toBe("old")
  })

  it("reports the status when the wall says no", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":"invalid or missing invite key"}', { status: 401 }))
    await expect(
      postItem(Buffer.from("x"), { title: "t", templateId: "d", tags: [] }, { inviteKey: "wrong" }),
    ).rejects.toThrow(/401/)
  })
})

/** a stand-in chromium: connected until killed, then it says so the way playwright does */
function fakeBrowser(): Browser & { kill(): void } {
  const events = new EventEmitter()
  let connected = true
  return Object.assign(events, {
    isConnected: () => connected,
    close: async () => {
      connected = false
    },
    kill() {
      connected = false
      events.emit("disconnected")
    },
  }) as unknown as Browser & { kill(): void }
}

describe("browser", () => {
  afterEach(() => closeBrowser())

  it("reuses one live chromium", async () => {
    const launch = vi.fn(async () => fakeBrowser())
    const a = await browser(launch)
    expect(await browser(launch)).toBe(a)
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it("launches a new chromium after the old one was killed", async () => {
    const first = fakeBrowser()
    const second = fakeBrowser()
    const launch = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    expect(await browser(launch)).toBe(first)
    first.kill()
    expect(await browser(launch)).toBe(second)
  })

  it("notices a dead chromium even without the disconnected event", async () => {
    const first = fakeBrowser()
    const second = fakeBrowser()
    const launch = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    await browser(launch)
    await first.close()
    expect(await browser(launch)).toBe(second)
  })

  it("tries again after a failed launch instead of caching the failure", async () => {
    const ok = fakeBrowser()
    const launch = vi.fn().mockRejectedValueOnce(new Error("no chromium")).mockResolvedValueOnce(ok)
    await expect(browser(launch)).rejects.toThrow(/no chromium/)
    expect(await browser(launch)).toBe(ok)
  })
})

describe("claudeResult", () => {
  const run = { err: "", timedOut: false, timeoutMs: 1000 }

  it("returns the result of a good run", () => {
    expect(claudeResult({ ...run, code: 0, out: '{"result":"hi"}' })).toBe("hi")
  })

  it("says why a run failed when the reason is only on stdout", () => {
    const out = JSON.stringify({
      type: "result",
      is_error: true,
      result: "You've hit your weekly limit · resets 10am (America/Los_Angeles)",
    })
    expect(() => claudeResult({ ...run, code: 1, out })).toThrow(/exited 1: You've hit your weekly limit/)
  })

  it("keeps stderr when there is some", () => {
    expect(() => claudeResult({ ...run, code: 2, out: "", err: "unknown option" })).toThrow(
      /exited 2: unknown option/,
    )
  })

  it("names a timeout", () => {
    expect(() => claudeResult({ ...run, code: null, out: "", timedOut: true })).toThrow(/timed out/)
  })
})
