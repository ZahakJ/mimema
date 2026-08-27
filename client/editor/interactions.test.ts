import { describe, expect, it } from "vitest"
import {
  applyDrag,
  applyResize,
  applyRotate,
  clampRect,
  handlePosition,
  hitTest,
  type FracRect,
} from "./interactions.ts"

const rect: FracRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.25, angle: 0 }

describe("hitTest", () => {
  it("hits inside, misses outside", () => {
    expect(hitTest(rect, 0.5, 0.35, 1)).toBe(true)
    expect(hitTest(rect, 0.1, 0.1, 1)).toBe(false)
  })
  it("respects rotation", () => {
    const rot = { ...rect, angle: 90 } // wide box becomes tall about its center
    expect(hitTest(rot, 0.5, 0.55, 1)).toBe(true)
    expect(hitTest(rot, 0.28, 0.37, 1)).toBe(false)
  })
})

describe("applyDrag", () => {
  it("moves and clamps", () => {
    const moved = applyDrag(rect, 0.1, -0.05)
    expect(moved.x).toBeCloseTo(0.35)
    expect(moved.y).toBeCloseTo(0.2)
    const flungOff = applyDrag(rect, 5, 5)
    expect(flungOff.x).toBeLessThanOrEqual(0.96)
    expect(flungOff.y).toBeLessThanOrEqual(0.96)
  })
})

describe("applyResize", () => {
  it("se handle grows width and height, anchors nw corner", () => {
    const r = applyResize(rect, "se", 0.1, 0.1, 1)
    expect(r.x).toBeCloseTo(0.25)
    expect(r.y).toBeCloseTo(0.25)
    expect(r.w).toBeCloseTo(0.6)
    expect(r.h).toBeCloseTo(0.35)
  })
  it("nw handle moves origin and shrinks", () => {
    const r = applyResize(rect, "nw", 0.05, 0.05, 1)
    expect(r.x).toBeCloseTo(0.3)
    expect(r.w).toBeCloseTo(0.45)
    expect(r.h).toBeCloseTo(0.2)
  })
  it("enforces a minimum size", () => {
    const r = applyResize(rect, "se", -1, -1, 1)
    expect(r.w).toBeGreaterThanOrEqual(0.02)
    expect(r.h).toBeGreaterThanOrEqual(0.02)
  })
  it("transforms deltas into the rotated frame", () => {
    const rot = { ...rect, angle: 90 }
    // pointer moving +y in doc space is +x in the box's local space at 90°
    const r = applyResize(rot, "e", 0, 0.1, 1)
    expect(r.w).toBeCloseTo(0.6)
    expect(r.h).toBeCloseTo(0.25)
  })
})

describe("applyRotate", () => {
  it("faces the pointer and snaps to cardinals", () => {
    // pointer straight above center → 0°, within snap range
    const r = applyRotate(rect, 0.5, 0.1, 1)
    expect(r.angle).toBe(0)
    // pointer to the right of center → 90°
    const r2 = applyRotate(rect, 0.9, 0.375, 1)
    expect(r2.angle).toBe(90)
  })
})

describe("handlePosition", () => {
  it("puts se at the corner for an unrotated rect", () => {
    const p = handlePosition(rect, "se", 1)
    expect(p.x).toBeCloseTo(0.75)
    expect(p.y).toBeCloseTo(0.5)
  })
})

describe("clampRect", () => {
  it("keeps a sliver visible", () => {
    const gone = clampRect({ x: -2, y: 3, w: 0.3, h: 0.3, angle: 0 })
    expect(gone.x).toBeGreaterThanOrEqual(-0.26)
    expect(gone.y).toBeLessThanOrEqual(0.96)
  })
})
