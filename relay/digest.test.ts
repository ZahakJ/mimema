import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import {
  DEFAULT_COUNT,
  DEFAULT_NEWS_MODEL,
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
  redoFile,
  storyTokens,
  tagSafe,
  tasteFile,
  vetPicks,
  type DigestPick,
  type Feedback,
} from "./digest.ts"
import type { ForgeOpts, ForgeResult, Pick } from "./forge.ts"

const STORY: DigestPick = {
  title: "Vertex Cloud calls its 4-hour outage 'unprecedented'",
  blurb: "Per Reuters, Vertex Cloud blamed a config push for a 4-hour outage across three regions.",
  sourceUrl: "https://example.com/news/outage",
  topic: "tech",
  shape: "denial",
  why: "the outage is the fire: the config push on top, Vertex's own statement underneath",
  templateId: "this-is-fine",
  captions: ["Vertex pushes one config change", "unprecedented, and fine"],
}

const SECOND: DigestPick = {
  ...STORY,
  title: "Astral Studios delays the Hollow sequel a third time",
  blurb: "Per The Verge, Astral Studios moved Hollow II to 2028 — its third slip.",
  sourceUrl: "https://example.com/news/delay",
  topic: "culture",
  shape: "predictable",
  why: "Astral's first promise is the rejected zone, the 2028 date the approved one",
  // no curated meaning for this id, so vetPicks cannot check its shape — on purpose
  templateId: "drake",
  captions: ["Astral promises Hollow II this year", "Astral says 2028, again"],
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

describe("storyTokens", () => {
  it("keeps the names and the numbers and drops the grammar", () => {
    const t = storyTokens("Per Reuters, Bungie denied that Destiny and Marathon are merging in 2027.")
    expect([...t].sort()).toEqual(["2027", "bungie", "destiny", "marathon", "reuter"])
  })

  it("folds possessives and plurals so a caption can inflect them", () => {
    expect(storyTokens("OpenAI's framework").has("openai")).toBe(true)
    expect(storyTokens("Two Chargers fumbles").has("charger")).toBe(true)
  })

  it("is generous with a Title Case headline rather than clever", () => {
    // every word is capitalised, so nearly every content word counts. That is
    // the intent: this is a floor under the captions, not a judge of them.
    const t = storyTokens("Blood Group Mystery from 1972 Officially Ratified as MAL System")
    expect(t.has("blood")).toBe(true)
    expect(t.has("1972")).toBe(true)
    expect(t.has("from")).toBe(false)
  })
})

describe("vetPicks", () => {
  const pick = (over: Partial<DigestPick>): DigestPick => ({ ...STORY, ...over })

  it("keeps a pick that names the story and fits the template's meaning", () => {
    const { kept, rejected } = vetPicks([pick({}), pick({ ...SECOND })])
    expect(rejected).toEqual([])
    expect(kept).toHaveLength(2)
  })

  it("refuses captions that share no name, number or product with the story", () => {
    const { kept, rejected } = vetPicks([pick({ captions: ["when you ship on a friday", "this is fine"] })])
    expect(kept).toEqual([])
    expect(rejected[0]?.why).toMatch(/share not one name/)
    // the reason hands the desk the nouns it should have used
    expect(rejected[0]?.why).toContain("vertex")
  })

  it("still accepts a joke that paraphrases, as long as one noun survives", () => {
    const { kept } = vetPicks([pick({ captions: ["Vertex: it was one config push", "nothing to see"] })])
    expect(kept).toHaveLength(1)
  })

  it("refuses a template whose picture cannot carry the stated shape", () => {
    const { kept, rejected } = vetPicks([pick({ shape: "escalation" })])
    expect(kept).toEqual([])
    // and it says what the picture actually means, so the redo has something to work with
    expect(rejected[0]?.why).toMatch(/this-is-fine cannot carry an? "escalation" joke/)
    expect(rejected[0]?.why).toMatch(/burning room/)
  })

  it("lets a template with no curated meaning through whatever the shape", () => {
    expect(vetPicks([pick({ ...SECOND, shape: "escalation" })]).kept).toHaveLength(1)
  })

  it("refuses the same template twice in one digest", () => {
    const { kept, rejected } = vetPicks([
      pick({}),
      pick({ ...SECOND, templateId: "this-is-fine", shape: "denial" }),
    ])
    expect(kept).toHaveLength(1)
    expect(rejected[0]?.why).toMatch(/already used by another story/)
  })

  it("refuses a second story from a topic the digest already has", () => {
    const { kept, rejected } = vetPicks([pick({}), pick({ ...SECOND, topic: "tech" })])
    expect(kept).toHaveLength(1)
    expect(rejected[0]?.why).toMatch(/spread the digest across topics/)
  })

  it("passes every meme the desk actually posted in September", () => {
    // The real digests: the check is a floor, so all of these clear it. What
    // was wrong with half of them is the joke, which no regex can measure —
    // that is Step 5 of the skill's job, not this function's. If a change here
    // starts rejecting these, it has become a taste test and gone too far.
    const real: [string, string, string[]][] = [
      [
        "Plugin4Shell Bug Lets Malicious Code Slip Past AI Coding Agents' SHA Pins",
        "A plugin can be pinned to an exact SHA and still load unreviewed code.",
        ["pin every plugin to an exact SHA hash", "so nobody can slip in unreviewed code",
         "name your malicious branch after that same SHA", "name your malicious branch after that same SHA"],
      ],
      [
        "Bungie shoots down leak claiming Destiny and Marathon are merging",
        "Bungie denied a leak that Destiny and Marathon would merge.",
        ["leak: Destiny and Marathon are merging", "Bungie: nope, they're just siblings"],
      ],
      [
        "Zuckerberg breaks from Altman, Musk, and Amodei on slowing AI down",
        "Zuckerberg declined to join calls for a slowdown.",
        ["am I wrong to keep racing?", "no, Altman, Musk, and Amodei are wrong"],
      ],
    ]
    for (const [title, blurb, captions] of real) {
      const { kept } = vetPicks([pick({ title, blurb, captions, templateId: "x-unknown", topic: "tech" })])
      expect(kept, title).toHaveLength(1)
    }
  })
})

describe("redoFile", () => {
  it("names what was refused, why, and what is already taken", () => {
    const bad = { ...STORY, shape: "escalation" } as DigestPick
    const text = redoFile(null, [{ pick: bad, why: "this-is-fine cannot carry that" }], [SECOND as DigestPick])
    expect(text).toContain("# Redo")
    expect(text).toContain(`"${STORY.title}" (this-is-fine) — this-is-fine cannot carry that`)
    expect(text).toContain(`"${SECOND.title}" [culture] (drake)`)
  })

  it("says so when the whole answer was unusable", () => {
    expect(redoFile("no JSON object in the picker's answer", [], [])).toContain("no JSON object")
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
          // the first ask; a re-ask appends --redo and is its own test
          seen ??= { prompt, taste: await readFile(taste, "utf8"), exclude }
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
          if (prompt === "") {
            prompt = a.prompt
            taste = await readFile(/--taste (\S+)/.exec(a.prompt)![1]!, "utf8")
          }
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
    await pickNews({ count: 99 }, { runner: async (a) => ((prompt ||= a.prompt), json(STORY)) })
    expect(prompt).toContain("--count 4")
  })

  it("sends the digest to the good model, not the forge's cheap one", async () => {
    const before = { news: process.env.MEME_NEWS_MODEL, relay: process.env.MEME_RELAY_MODEL }
    try {
      delete process.env.MEME_NEWS_MODEL
      // the /forge knob must not drag the news desk down with it
      process.env.MEME_RELAY_MODEL = "haiku"
      let model: string | undefined
      await pickNews({ count: 1 }, { runner: async (a) => ((model = a.model), json(STORY)) })
      expect(model).toBe(DEFAULT_NEWS_MODEL)
      expect(DEFAULT_NEWS_MODEL).toBe("opus")

      process.env.MEME_NEWS_MODEL = "fable"
      await pickNews({ count: 1 }, { runner: async (a) => ((model = a.model), json(STORY)) })
      expect(model).toBe("fable")
    } finally {
      if (before.news === undefined) delete process.env.MEME_NEWS_MODEL
      else process.env.MEME_NEWS_MODEL = before.news
      if (before.relay === undefined) delete process.env.MEME_RELAY_MODEL
      else process.env.MEME_RELAY_MODEL = before.relay
    }
  })

  it("asks the desk again, once, with the reason a pick was refused", async () => {
    const prompts: string[] = []
    let redo = ""
    const picks = await pickNews(
      { count: 2 },
      {
        runner: async ({ prompt }) => {
          prompts.push(prompt)
          const path = /--redo (\S+)/.exec(prompt)?.[1]
          if (path === undefined) {
            // one good pick, one whose captions are about nothing
            return json(STORY, { ...SECOND, captions: ["when you ship on a friday", "oh no"] })
          }
          redo = await readFile(path, "utf8")
          return json({ ...SECOND, topic: "sports", templateId: "gru-s-plan", shape: "predictable" })
        },
      },
    )
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toBe("/meme-news --json --count 2")
    // only the missing slot is re-asked for
    expect(prompts[1]).toMatch(/^\/meme-news --json --count 1 --redo \S+\/redo\.md$/)
    expect(redo).toMatch(/share not one name/)
    expect(redo).toContain(STORY.title)
    expect(picks).toHaveLength(2)
    expect(picks[1]?.templateId).toBe("gru-s-plan")
  })

  it("does not re-ask when every pick passes", async () => {
    let calls = 0
    await pickNews({ count: 2 }, { runner: async () => ((calls += 1), json(STORY, SECOND)) })
    expect(calls).toBe(1)
  })

  it("re-asks after an answer that was not JSON at all, and keeps what comes back", async () => {
    const prompts: string[] = []
    const picks = await pickNews(
      { count: 1 },
      {
        runner: async ({ prompt }) => {
          prompts.push(prompt)
          return prompt.includes("--redo") ? json(STORY) : "I could not find any news today."
        },
      },
    )
    expect(prompts).toHaveLength(2)
    expect(picks).toHaveLength(1)
  })

  it("ships the refused picks rather than nothing when the redo fails too", async () => {
    // a flawed meme beats a silent morning; the journal carries the reason
    const flat = { ...STORY, captions: ["when you ship on a friday", "oh no"] }
    const picks = await pickNews({ count: 1 }, { runner: async () => json(flat) })
    expect(picks).toHaveLength(1)
    expect(picks[0]?.title).toBe(STORY.title)
  })

  it("removes the redo file with the rest of the temp dir", async () => {
    let path = ""
    await pickNews(
      { count: 2 },
      {
        runner: async ({ prompt }) => {
          const p = /--redo (\S+)/.exec(prompt)?.[1]
          if (p !== undefined) path = p
          return json(STORY)
        },
      },
    )
    expect(path).not.toBe("")
    expect(await readFile(path, "utf8").catch(() => null)).toBeNull()
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
    // exactly the wire Binary codes against — and `shape`/`why`, the desk's
    // working, are NOT on it: they are for the journal and the relay's check
    expect(result.items[0]).toEqual({
      title: STORY.title,
      blurb: STORY.blurb,
      sourceUrl: STORY.sourceUrl,
      topic: "tech",
      templateId: "this-is-fine",
      captions: STORY.captions,
      slug: "slug-1",
      url: "https://meme.example/m/slug-1.png",
      shareUrl: "https://meme.example/m/slug-1",
    })
    expect(result.items[0]).not.toHaveProperty("shape")
    expect(result.items[0]).not.toHaveProperty("why")
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
    expect(result.items[0]?.captions).toEqual([...STORY.captions, ""])
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
