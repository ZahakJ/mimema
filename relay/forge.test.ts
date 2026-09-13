import { afterEach, describe, expect, it, vi } from "vitest"
import {
  dataUrlToBuffer,
  editUrl,
  extractJson,
  fetchTemplate,
  fitCaptions,
  parsePick,
  pickMeme,
  postItem,
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
  it("runs the /meme slash form at the repo root and parses the answer", async () => {
    const calls: unknown[] = []
    const pick = await pickMeme("/tmp/ctx.txt", {
      model: "sonnet",
      runner: async (args) => {
        calls.push(args)
        return "```json\n" + PICK + "\n```"
      },
    })
    expect(pick.templateId).toBe("drake")
    expect(calls[0]).toMatchObject({ prompt: "/meme --json /tmp/ctx.txt", model: "sonnet" })
    expect((calls[0] as { cwd: string }).cwd).toMatch(/mimema$/)
  })

  it("surfaces a runner failure", async () => {
    await expect(
      pickMeme("/tmp/ctx.txt", {
        runner: async () => {
          throw new Error("claude timed out after 180000ms")
        },
      }),
    ).rejects.toThrow(/timed out/)
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
