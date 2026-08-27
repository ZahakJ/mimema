// Pure pointer math for the canvas stage. All rects are in the fractional
// coordinate system (0..1 of the document); pointer positions arrive already
// normalized to fractions. Angles in degrees, clockwise, about rect center.

export type FracRect = { x: number; y: number; w: number; h: number; angle: number }

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

const MIN_SIZE = 0.02

/** Rotate point (px,py) about (cx,cy) by deg. aspect corrects for non-square docs. */
function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number,
  aspect: number,
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  // work in a square space so rotation is angle-true on non-square docs
  const dx = (px - cx) * aspect
  const dy = py - cy
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: cx + (dx * cos - dy * sin) / aspect, y: cy + (dx * sin + dy * cos) }
}

/** Point-in-rect test respecting rotation. aspect = docWidth / docHeight. */
export function hitTest(rect: FracRect, px: number, py: number, aspect: number): boolean {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const p = rotatePoint(px, py, cx, cy, -rect.angle, aspect)
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h
}

export const HANDLES: { handle: Handle; hx: number; hy: number }[] = [
  { handle: "nw", hx: 0, hy: 0 },
  { handle: "n", hx: 0.5, hy: 0 },
  { handle: "ne", hx: 1, hy: 0 },
  { handle: "e", hx: 1, hy: 0.5 },
  { handle: "se", hx: 1, hy: 1 },
  { handle: "s", hx: 0.5, hy: 1 },
  { handle: "sw", hx: 0, hy: 1 },
  { handle: "w", hx: 0, hy: 0.5 },
]

/** Position of a resize handle in fractional doc coords. */
export function handlePosition(
  rect: FracRect,
  handle: Handle,
  aspect: number,
): { x: number; y: number } {
  const spec = HANDLES.find((h) => h.handle === handle)!
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  return rotatePoint(rect.x + spec.hx * rect.w, rect.y + spec.hy * rect.h, cx, cy, rect.angle, aspect)
}

export function applyDrag(rect: FracRect, dx: number, dy: number): FracRect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy })
}

/**
 * Resize by dragging a handle. The pointer delta is transformed into the
 * rect's local (unrotated) frame, then the opposite edge stays anchored.
 */
export function applyResize(
  rect: FracRect,
  handle: Handle,
  dx: number,
  dy: number,
  aspect: number,
): FracRect {
  const rad = (-rect.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const ldx = (dx * aspect * cos - dy * sin) / aspect
  const ldy = dx * aspect * sin + dy * cos

  let { x, y, w, h } = rect
  if (handle.includes("e")) w += ldx
  if (handle.includes("w")) {
    x += ldx
    w -= ldx
  }
  if (handle.includes("s")) h += ldy
  if (handle.includes("n")) {
    y += ldy
    h -= ldy
  }
  if (w < MIN_SIZE) {
    if (handle.includes("w")) x -= MIN_SIZE - w
    w = MIN_SIZE
  }
  if (h < MIN_SIZE) {
    if (handle.includes("n")) y -= MIN_SIZE - h
    h = MIN_SIZE
  }
  return clampRect({ ...rect, x, y, w, h })
}

/** Angle (deg) so the rect faces the pointer from its center; snaps near 0/90/180/270. */
export function applyRotate(rect: FracRect, px: number, py: number, aspect: number): FracRect {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  // the rotate handle lives above the box, so "pointer straight up" is 0°
  const deg = (Math.atan2(py - cy, (px - cx) * aspect) * 180) / Math.PI + 90
  let angle = ((deg + 540) % 360) - 180
  for (const snap of [-180, -90, 0, 90, 180]) {
    if (Math.abs(angle - snap) < 5) angle = snap === -180 ? 180 : snap
  }
  return { ...rect, angle }
}

/** Keep rects findable — at least a sliver must stay inside the doc. */
export function clampRect(rect: FracRect): FracRect {
  const margin = 0.04
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, margin - rect.w), 1 - margin),
    y: Math.min(Math.max(rect.y, margin - rect.h), 1 - margin),
  }
}
