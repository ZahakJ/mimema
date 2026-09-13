import { describe, expect, it } from "vitest"
import { parseHash } from "./router.ts"

describe("parseHash", () => {
  it("maps the plain routes", () => {
    expect(parseHash("")).toEqual({ view: "editor" })
    expect(parseHash("#/")).toEqual({ view: "editor" })
    expect(parseHash("#/wall")).toEqual({ view: "wall" })
    expect(parseHash("#/add-template")).toEqual({ view: "add-template" })
    expect(parseHash("#/paper")).toEqual({ view: "paper" })
    expect(parseHash("#/nonsense")).toEqual({ view: "editor" })
  })

  it("reads a bare #/edit/<id> exactly as before — no captions key", () => {
    expect(parseHash("#/edit/two-buttons")).toEqual({
      view: "editor",
      templateId: "two-buttons",
    })
    // an empty id is not a deep link
    expect(parseHash("#/edit/")).toEqual({ view: "editor" })
  })

  it("collects one caption per ?c=, in order", () => {
    expect(parseHash("#/edit/drake?c=one&c=two&c=three")).toEqual({
      view: "editor",
      templateId: "drake",
      captions: ["one", "two", "three"],
    })
  })

  it("URL-decodes captions, spaces, newlines and emoji included", () => {
    const route = parseHash("#/edit/drake?c=hello%20world&c=two%0Alines&c=%F0%9F%94%A5&c=a%2Bb")
    expect(route).toMatchObject({
      captions: ["hello world", "two\nlines", "🔥", "a+b"],
    })
  })

  it("keeps empty captions as empty strings (position matters)", () => {
    expect(parseHash("#/edit/drake?c=&c=second")).toMatchObject({
      captions: ["", "second"],
    })
  })

  it("takes an optional title, trimmed and capped", () => {
    expect(parseHash("#/edit/drake?c=hi&title=My%20Meme")).toEqual({
      view: "editor",
      templateId: "drake",
      captions: ["hi"],
      title: "My Meme",
    })
    expect(parseHash("#/edit/drake?title=%20%20")).toEqual({
      view: "editor",
      templateId: "drake",
    })
    expect(parseHash(`#/edit/drake?title=${"x".repeat(300)}`)).toMatchObject({
      title: "x".repeat(140),
    })
  })

  it("takes a title with no captions, and captions with no title", () => {
    expect(parseHash("#/edit/drake?title=solo")).toEqual({
      view: "editor",
      templateId: "drake",
      title: "solo",
    })
    expect(parseHash("#/edit/drake?c=solo")).toEqual({
      view: "editor",
      templateId: "drake",
      captions: ["solo"],
    })
  })

  it("decodes an encoded template id and survives a malformed escape", () => {
    expect(parseHash("#/edit/two%20buttons?c=a")).toMatchObject({ templateId: "two buttons" })
    // a lone % would throw out of decodeURIComponent — the hash still routes
    expect(parseHash("#/edit/100%?c=100%")).toMatchObject({
      view: "editor",
      templateId: "100%",
    })
  })

  it("ignores junk in the query and a query on other routes", () => {
    expect(parseHash("#/edit/drake?zzz=1&c=kept&=&&")).toMatchObject({ captions: ["kept"] })
    expect(parseHash("#/edit/drake?")).toEqual({ view: "editor", templateId: "drake" })
    expect(parseHash("#/wall?c=nope")).toEqual({ view: "wall" })
  })
})
