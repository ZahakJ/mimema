import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import {
  DEFAULT_COUNT,
  MAX_COUNT,
  MAX_FEEDBACK,
  MAX_FEEDBACK_TITLE,
  MAX_INTERESTS_CHARS,
  NEWS_TOOLS,
  clampCount,
  cleanFeedback,
  cleanInterests,
  digest,
  parseDigest,
  pickNews,
  tagSafe,
  tasteFile,
  type Feedback,
} from "./digest.ts"
import type { ForgeOpts, ForgeResult, Pick } from "./forge.ts"

const STORY = {
  title: "Cloud provider explains outage with the word 'unprecedented'",
  blurb: "Per Reuters, the provider blamed a config push for a four-hour outage.",
  sourceUrl: "https://example.com/news/outage",
  topic: "tech",
  templateId: "this-is-fine",
  captions: ["everything is on fire", "this is fine"],
}

const SECOND = {
  ...STORY,
  title: "Studio delays the sequel a third time",
  sourceUrl: "https://example.com/news/delay",
  topic: "culture",
  templateId: "drake",
}

const json = (...items: object[]) => JSON.stringify({ items })

/** a forgePick that always succeeds, recording what it was handed */
function fakeForge(calls: { pick: Pick; opts: ForgeOpts | undefined }[] = []) {
  return {
    calls,
    forgePick: async (pick: Pick, opts?: ForgeOpts): Promise<ForgeResult> => {
      calls.push({ pick, opts })
      return {
        slug: `slug-${calls.length}`,
        url: `https://meme.example/m/slug-${calls.length}.png`,
        shareUrl: `https://meme.example/m/slug-${calls.length}`,
        templateId: pick.templateId,
        captions: pick.captions,
        title: pick.title,
        pngBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      }
    },
  }
}

describe("clampCount", () => {
  it("defaults, floors and caps", () => {
    expect(clampCount(undefined)).toBe(DEFAULT_COUNT)
    expect(clampCount(1)).toBe(1)
    expect(clampCount(99)).toBe(MAX_COUNT)
    expect(clampCount(0)).toBe(1)
    expect(clampCount(2.7)).toBe(2)
  })
})

describe("tagSafe", () => {
  it("keeps a slug and drops anything else", () => {
    expect(tagSafe(" Discord ")).toBe("discord")
    expect(tagSafe("go-binary")).toBe("go-binary")
    expect(tagSafe("../etc")).toBeNull()
    expect(tagSafe("a b")).toBeNull()
    expect(tagSafe("")).toBeNull()
  })
})

const CARDINALS: Feedback = { title: "Cardinals Stun Chargers in OT", topic: "sports", up: 1, down: 4 }
const LEVEL5: Feedback = { title: "Level-5 CEO Says Sorry For AI In Trailers", topic: "culture", up: 6, down: 0 }
const OUTAGE: Feedback = { title: "Cloud outage called unprecedented", topic: "tech", up: 2, down: 2 }

describe("cleanInterests", () => {
  it("collapses whitespace and returns null for nothing", () => {
    expect(cleanInterests("  medicine,\n science ")).toBe("medicine, science")
    expect(cleanInterests("")).toBeNull()
    expect(cleanInterests("   ")).toBeNull()
    expect(cleanInterests(undefined)).toBeNull()
    expect(cleanInterests(42)).toBeNull()
  })

  it("trims an over-long brief to the cap with an ellipsis", () => {
    const long = "x".repeat(MAX_INTERESTS_CHARS + 50)
    const got = cleanInterests(long)!
    expect(got).toHaveLength(MAX_INTERESTS_CHARS)
    expect(got.endsWith("…")).toBe(true)
    expect(cleanInterests("x".repeat(MAX_INTERESTS_CHARS))).toHaveLength(MAX_INTERESTS_CHARS)
  })
})

describe("cleanFeedback", () => {
  it("keeps a well-formed entry as is", () => {
    expect(cleanFeedback([CARDINALS])).toEqual([CARDINALS])
  })

  it("drops malformed entries silently and keeps the rest", () => {
    const got = cleanFeedback([
      null,
      "string",
      [],
      { title: "no counts", topic: "tech" },
      { title: "", topic: "tech", up: 1, down: 0 },
      { title: 7, topic: "tech", up: 1, down: 0 },
      { title: "negative", topic: "tech", up: -1, down: 0 },
      { title: "fractional", topic: "tech", up: 1.5, down: 0 },
      { title: "stringy", topic: "tech", up: "1", down: 0 },
      { title: "topic missing", up: 1, down: 0 },
      LEVEL5,
    ])
    expect(got).toEqual([LEVEL5])
  })

  it("caps the title, flattens whitespace, and falls back on an empty topic", () => {
    const got = cleanFeedback([
      { title: "y".repeat(MAX_FEEDBACK_TITLE + 20), topic: "  ", up: 0, down: 0 },
      { title: "two\nlines  here", topic: "tech", up: 0, down: 0 },
    ])
    expect(got[0]?.title).toHaveLength(MAX_FEEDBACK_TITLE)
    expect(got[0]?.title.endsWith("…")).toBe(true)
    expect(got[0]?.topic).toBe("?")
    expect(got[1]?.title).toBe("two lines here")
  })

  it("keeps the first MAX_FEEDBACK survivors, in the order given", () => {
    const many = Array.from({ length: MAX_FEEDBACK + 10 }, (_, i) => ({ ...OUTAGE, title: `story ${i}` }))
    const got = cleanFeedback([{ bad: true }, ...many])
    expect(got).toHaveLength(MAX_FEEDBACK)
    expect(got[0]?.title).toBe("story 0")
    expect(got[MAX_FEEDBACK - 1]?.title).toBe(`story ${MAX_FEEDBACK - 1}`)
  })
})

describe("tasteFile", () => {
  it("writes the brief and the reactions, best-received first", () => {
    const text = tasteFile("medicine, science, video games", [CARDINALS, OUTAGE, LEVEL5])
    expect(text).toBe(
      [
        "# Interests",
        "medicine, science, video games",
        "",
        "# Reactions to earlier posts (👍 / 👎)",
        "- 👍 6  👎 0  [culture]  Level-5 CEO Says Sorry For AI In Trailers",
        "- 👍 2  👎 2  [tech]     Cloud outage called unprecedented",
        "- 👍 1  👎 4  [sports]   Cardinals Stun Chargers in OT",
        "",
      ].join("\n"),
    )
  })

  it("sorts by up minus down, not by up alone", () => {
    const text = tasteFile(null, [
      { title: "loud", topic: "tech", up: 10, down: 9 },
      { title: "quiet", topic: "tech", up: 3, down: 0 },
    ])
    expect(text.indexOf("quiet")).toBeLessThan(text.indexOf("loud"))
  })

  it("says so when there are no interests, or no reactions, or neither", () => {
    expect(tasteFile(null, [LEVEL5])).toContain("# Interests\n(none stated)\n")
    expect(tasteFile("tech", [])).toContain("(👍 / 👎)\n(none yet)\n")
    expect(tasteFile("", [])).toBe("# Interests\n(none stated)\n\n# Reactions to earlier posts (👍 / 👎)\n(none yet)\n")
  })

  it("applies the same truncation the wire does", () => {
    const text = tasteFile("x".repeat(9999), [{ ...LEVEL5, title: "t".repeat(9999) }, { junk: 1 } as never])
    const [, brief] = text.split("\n")
    expect(brief).toHaveLength(MAX_INTERESTS_CHARS)
    expect(text.split("\n").filter((l) => l.startsWith("- 👍"))).toHaveLength(1)
    expect(/t+…$/m.test(text)).toBe(true)
  })
})

describe("parseDigest", () => {
  it("reads a bare object", () => {
    expect(parseDigest(json(STORY), 2)).toHaveLength(1)
  })

  it("reads a fenced block with prose around it", () => {
    const raw = "Here are today's stories:\n```json\n" + json(STORY) + "\n```\nThat's the lot."
    expect(parseDigest(raw, 2)[0]?.templateId).toBe("this-is-fine")
  })

  it("trims to the requested count", () => {
    const picks = parseDigest(json(STORY, SECOND, { ...STORY, topic: "sports" }), 2)
    expect(picks).toHaveLength(2)
    expect(picks.map((p) => p.topic)).toEqual(["tech", "culture"])
  })

  it("rejects a topic outside the enum", () => {
    expect(() => parseDigest(json({ ...STORY, topic: "gossip" }), 2)).toThrow(/topic/)
  })

  it("rejects a sourceUrl that is not a URL", () => {
    expect(() => parseDigest(json({ ...STORY, sourceUrl: "reuters, probably" }), 2)).toThrow(/sourceUrl/)
  })

  it("accepts a well-formed URL even when it looks invented — zod cannot know", () => {
    // the guard against a hallucinated link is the skill's Don'ts, not the schema;
    // this test exists so nobody mistakes the zod pass for a fact-check
    const picks = parseDigest(json({ ...STORY, sourceUrl: "https://reuters.com/totally/made/up" }), 1)
    expect(picks[0]?.sourceUrl).toBe("https://reuters.com/totally/made/up")
  })

  it("rejects a missing blurb or title", () => {
    const { blurb: _b, ...noBlurb } = STORY
    expect(() => parseDigest(json(noBlurb), 2)).toThrow(/blurb/)
    expect(() => parseDigest(json({ ...STORY, title: "" }), 2)).toThrow(/title/)
  })

  it("rejects an empty items array", () => {
    expect(() => parseDigest('{"items":[]}', 2)).toThrow(/no stories/)
  })

  it("throws readably when there is no JSON at all", () => {
    expect(() => parseDigest("I could not find any news today.", 2)).toThrow(/no JSON object/)
  })
})

describe("pickNews", () => {
  it("runs the slash form at the repo root with the web tools allowed", async () => {
    const calls: Parameters<NonNullable<Parameters<typeof pickNews>[1]>["runner"] & object>[0][] = []
    await pickNews(
      { count: 3, model: "sonnet" },
      {
        runner: async (args) => {
          calls.push(args)
          return json(STORY)
        },
      },
    )
    expect(calls[0]?.prompt).toBe("/meme-news --json --count 3")
    expect(calls[0]?.model).toBe("sonnet")
    expect(calls[0]?.allowedTools).toEqual(NEWS_TOOLS)
    expect(calls[0]?.allowedTools).toContain("WebSearch")
    expect(calls[0]?.allowedTools).toContain("WebFetch")
    expect(calls[0]?.cwd).toMatch(/mimema$/)
    expect(calls[0]?.timeoutMs).toBe(300_000)
  })

  it("writes the exclude list to a temp file, passes its path, and removes it after", async () => {
    let seen: { path: string; text: string } | null = null
    await pickNews(
      { exclude: ["Old headline", "https://example.com/old", "  ", ""] },
      {
        runner: async ({ prompt }) => {
          const p = /--exclude (\S+)/.exec(prompt)?.[1] ?? ""
          seen = { path: p, text: await readFile(p, "utf8") }
          return json(STORY)
        },
      },
    )
    const got = seen as unknown as { path: string; text: string }
    expect(got.text).toBe("Old headline\nhttps://example.com/old\n")
    expect(await readFile(got.path, "utf8").catch(() => null)).toBeNull()
  })

  it("writes the taste file next to the exclude list and passes --taste", async () => {
    let seen: { prompt: string; taste: string; exclude: string } | null = null
    await pickNews(
      { exclude: ["Old headline"], interests: "medicine, science", feedback: [CARDINALS, LEVEL5] },
      {
        runner: async ({ prompt }) => {
          const taste = /--taste (\S+)/.exec(prompt)?.[1] ?? ""
          const exclude = /--exclude (\S+)/.exec(prompt)?.[1] ?? ""
          seen = { prompt, taste: await readFile(taste, "utf8"), exclude }
          return json(STORY)
        },
      },
    )
    const got = seen as unknown as { prompt: string; taste: string; exclude: string }
    expect(got.prompt).toMatch(/^\/meme-news --json --count 2 --exclude \S+\/exclude\.txt --taste \S+\/taste\.md$/)
    expect(got.taste).toBe(tasteFile("medicine, science", [CARDINALS, LEVEL5]))
    // same mkdtemp dir for both files
    const tastePath = /--taste (\S+)/.exec(got.prompt)![1]!
    expect(tastePath.slice(0, tastePath.lastIndexOf("/"))).toBe(got.exclude.slice(0, got.exclude.lastIndexOf("/")))
    expect(await readFile(tastePath, "utf8").catch(() => null)).toBeNull()
  })

  it("writes a taste file with no exclude list, from interests alone or feedback alone", async () => {
    for (const opts of [{ interests: "video games" }, { feedback: [LEVEL5] }]) {
      let prompt = ""
      let taste = ""
      await pickNews(opts, {
        runner: async (a) => {
          prompt = a.prompt
          taste = await readFile(/--taste (\S+)/.exec(a.prompt)![1]!, "utf8")
          return json(STORY)
        },
      })
      expect(prompt).not.toContain("--exclude")
      expect(prompt).toMatch(/--taste \S+\/taste\.md$/)
      expect(taste).toContain("# Interests")
    }
  })

  it("omits --taste when the taste is empty — the skill then behaves as before", async () => {
    let prompt = ""
    await pickNews(
      { count: 1, interests: "   ", feedback: [{ bad: true } as never] },
      { runner: async (a) => ((prompt = a.prompt), json(STORY)) },
    )
    expect(prompt).toBe("/meme-news --json --count 1")
  })

  it("omits --exclude when there is nothing to exclude", async () => {
    let prompt = ""
    await pickNews({ count: 1 }, { runner: async (a) => ((prompt = a.prompt), json(STORY)) })
    expect(prompt).toBe("/meme-news --json --count 1")
  })

  it("clamps an out-of-range count before asking", async () => {
    let prompt = ""
    await pickNews({ count: 99 }, { runner: async (a) => ((prompt = a.prompt), json(STORY)) })
    expect(prompt).toContain("--count 4")
  })

  it("surfaces a runner failure", async () => {
    await expect(
      pickNews(
        {},
        {
          runner: async () => {
            throw new Error("claude timed out after 300000ms")
          },
        },
      ),
    ).rejects.toThrow(/timed out/)
  })
})

describe("digest", () => {
  it("forges every pick and returns the wire shape", async () => {
    const fake = fakeForge()
    const result = await digest(
      { count: 2 },
      { runner: async () => json(STORY, SECOND), forgePick: fake.forgePick },
    )
    expect(result.errors).toEqual([])
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toEqual({
      title: STORY.title,
      blurb: STORY.blurb,
      sourceUrl: STORY.sourceUrl,
      topic: "tech",
      templateId: "this-is-fine",
      captions: ["everything is on fire", "this is fine"],
      slug: "slug-1",
      url: "https://meme.example/m/slug-1.png",
      shareUrl: "https://meme.example/m/slug-1",
    })
  })

  it("tags each wall item news + topic + a sanitized source", async () => {
    const fake = fakeForge()
    await digest(
      { count: 2, source: " Discord " },
      { runner: async () => json(STORY, SECOND), forgePick: fake.forgePick },
    )
    expect(fake.calls.map((c) => c.opts?.tags)).toEqual([
      ["news", "tech", "discord"],
      ["news", "culture", "discord"],
    ])
  })

  it("drops a source that is not a slug", async () => {
    const fake = fakeForge()
    await digest({ count: 1, source: "not a tag!" }, { runner: async () => json(STORY), forgePick: fake.forgePick })
    expect(fake.calls[0]?.opts?.tags).toEqual(["news", "tech"])
  })

  it("hands forgePick the pick shape forge() uses, alt included", async () => {
    const fake = fakeForge()
    await digest({ count: 1 }, { runner: async () => json(STORY), forgePick: fake.forgePick })
    expect(fake.calls[0]?.pick).toEqual({
      templateId: "this-is-fine",
      captions: STORY.captions,
      title: STORY.title,
      alt: null,
    })
  })

  it("takes the fitted captions back from the forge", async () => {
    const forgePick = async (pick: Pick): Promise<ForgeResult> => ({
      slug: "s",
      url: "u",
      shareUrl: "su",
      templateId: pick.templateId,
      // the template had three zones; the forge padded
      captions: [...pick.captions, ""],
      title: pick.title,
      pngBytes: Buffer.alloc(0),
    })
    const result = await digest({ count: 1 }, { runner: async () => json(STORY), forgePick })
    expect(result.items[0]?.captions).toEqual(["everything is on fire", "this is fine", ""])
  })

  it("returns the survivors and one line per failure", async () => {
    let n = 0
    const forgePick = async (pick: Pick): Promise<ForgeResult> => {
      if (++n === 1) throw new Error("picked a template that doesn't exist: this-is-fine\nstack\nlines")
      return {
        slug: "ok",
        url: "u",
        shareUrl: "su",
        templateId: pick.templateId,
        captions: pick.captions,
        title: pick.title,
        pngBytes: Buffer.alloc(0),
      }
    }
    const result = await digest({ count: 2 }, { runner: async () => json(STORY, SECOND), forgePick })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.title).toBe(SECOND.title)
    expect(result.errors).toEqual([`${STORY.title}: picked a template that doesn't exist: this-is-fine`])
  })

  it("returns zero items and every reason when all of them fail", async () => {
    const forgePick = async (): Promise<ForgeResult> => {
      throw new Error("posting to the wall failed: 401")
    }
    const result = await digest({ count: 2 }, { runner: async () => json(STORY, SECOND), forgePick })
    expect(result.items).toEqual([])
    expect(result.errors).toHaveLength(2)
  })

  it("trims to count before spending a single render", async () => {
    const fake = fakeForge()
    await digest(
      { count: 1 },
      { runner: async () => json(STORY, SECOND, { ...STORY, topic: "world" }), forgePick: fake.forgePick },
    )
    expect(fake.calls).toHaveLength(1)
  })

  it("throws when the pick step itself fails — there is nothing partial about that", async () => {
    await expect(
      digest({}, { runner: async () => "no news today", forgePick: fakeForge().forgePick }),
    ).rejects.toThrow(/no JSON object/)
  })
})
