import { describe, expect, it } from "vitest"
import { layoutText } from "./textLayout.ts"

// fake measurer: every char is fontPx * 0.5 wide
const measure = (text: string, fontPx: number) => text.length * fontPx * 0.5

describe("layoutText", () => {
  it("keeps short text on one line at full size", () => {
    const l = layoutText({ text: "LOL", boxW: 300, boxH: 100, fontPx: 60, measure })
    expect(l.lines).toEqual(["LOL"])
    expect(l.fontPx).toBe(60)
  })

  it("wraps at word boundaries", () => {
    const l = layoutText({ text: "one two three four", boxW: 200, boxH: 400, fontPx: 40, measure })
    // 40px font → 20px/char → 10 chars per line
    expect(l.lines.length).toBeGreaterThan(1)
    for (const line of l.lines) expect(measure(line, l.fontPx)).toBeLessThanOrEqual(200)
  })

  it("shrinks font until the block fits the box height", () => {
    const l = layoutText({ text: "a b c d e f g h", boxW: 60, boxH: 80, fontPx: 40, measure })
    expect(l.lines.length * l.fontPx * l.lineHeight).toBeLessThanOrEqual(80)
    expect(l.fontPx).toBeLessThan(40)
  })

  it("respects explicit newlines", () => {
    const l = layoutText({ text: "top\nbottom", boxW: 400, boxH: 200, fontPx: 30, measure })
    expect(l.lines).toEqual(["top", "bottom"])
  })

  it("stops at the minimum size for impossible text", () => {
    const l = layoutText({
      text: "incomprehensibilities",
      boxW: 20,
      boxH: 10,
      fontPx: 40,
      minPx: 9,
      measure,
    })
    expect(l.fontPx).toBe(9)
  })
})
