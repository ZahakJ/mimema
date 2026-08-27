// The single render path. Preview and export both go through renderMeme —
// they can never diverge. Draws in document pixel space; callers set the
// transform for display scaling.
import type { MemeDoc, TextLayer, StickerLayer, ZoneStyle } from "../../shared/schema.ts"
import { layoutText } from "./textLayout.ts"

export const FONT_CSS: Record<ZoneStyle["fontFamily"], string> = {
  Anton: '"Anton", Impact, "Arial Black", sans-serif',
  Bangers: '"Bangers", Impact, "Comic Sans MS", cursive',
  Oswald: '"Oswald", Impact, "Arial Narrow", sans-serif',
  Inter: '"Inter Variable", sans-serif',
  "JetBrains Mono": '"JetBrains Mono Variable", monospace',
}

/** the one weight we ship a face for, per family */
export const FONT_WEIGHT: Record<ZoneStyle["fontFamily"], string> = {
  Anton: "400",
  Bangers: "400",
  Oswald: "700",
  Inter: "800",
  "JetBrains Mono": "800",
}

/** the spec `document.fonts.load` wants — one place, so preload and paint
 *  can never ask for different faces */
export function fontLoadSpec(family: ZoneStyle["fontFamily"]): string {
  return `${FONT_WEIGHT[family]} 80px ${FONT_CSS[family].split(",")[0]!.trim()}`
}

export type Assets = {
  base: CanvasImageSource | null
  stickers: Map<string, CanvasImageSource>
}

export function renderMeme(
  ctx: CanvasRenderingContext2D,
  doc: MemeDoc,
  assets: Assets,
  opts: { hideLayerId?: string | null } = {},
): void {
  ctx.save()
  if (assets.base) {
    ctx.drawImage(assets.base, 0, 0, doc.width, doc.height)
  } else {
    ctx.fillStyle = "#141018"
    ctx.fillRect(0, 0, doc.width, doc.height)
  }
  for (const layer of doc.layers) {
    if (layer.id === opts.hideLayerId) continue
    if (layer.type === "sticker") drawSticker(ctx, layer, assets, doc)
    else drawText(ctx, layer, doc)
  }
  ctx.restore()
}

function drawSticker(
  ctx: CanvasRenderingContext2D,
  layer: StickerLayer,
  assets: Assets,
  doc: MemeDoc,
): void {
  const img = assets.stickers.get(layer.id)
  if (!img) return
  const bw = layer.w * doc.width
  const bh = layer.h * doc.height
  ctx.save()
  ctx.translate((layer.x + layer.w / 2) * doc.width, (layer.y + layer.h / 2) * doc.height)
  ctx.rotate((layer.angle * Math.PI) / 180)
  ctx.drawImage(img, -bw / 2, -bh / 2, bw, bh)
  ctx.restore()
}

function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer, doc: MemeDoc): void {
  const raw = layer.style.allCaps ? layer.text.toUpperCase() : layer.text
  if (!raw.trim()) return
  const bw = layer.w * doc.width
  const bh = layer.h * doc.height
  const family = FONT_CSS[layer.style.fontFamily]
  const weight = FONT_WEIGHT[layer.style.fontFamily]

  const measure = (text: string, fontPx: number): number => {
    ctx.font = `${weight} ${fontPx}px ${family}`
    return ctx.measureText(text).width
  }
  const { lines, fontPx, lineHeight } = layoutText({
    text: raw,
    boxW: bw,
    boxH: bh,
    fontPx: layer.style.fontFrac * doc.height,
    minPx: 0.02 * doc.height,
    measure,
  })

  ctx.save()
  ctx.translate((layer.x + layer.w / 2) * doc.width, (layer.y + layer.h / 2) * doc.height)
  ctx.rotate((layer.angle * Math.PI) / 180)
  ctx.font = `${weight} ${fontPx}px ${family}`
  ctx.textBaseline = "middle"
  ctx.textAlign = layer.align
  ctx.lineJoin = "round"
  ctx.miterLimit = 2

  const lineStep = fontPx * lineHeight
  const blockH = lines.length * lineStep
  let y: number
  if (layer.valign === "top") y = -bh / 2 + lineStep / 2
  else if (layer.valign === "bottom") y = bh / 2 - blockH + lineStep / 2
  else y = -blockH / 2 + lineStep / 2

  const x = layer.align === "left" ? -bw / 2 : layer.align === "right" ? bw / 2 : 0
  const strokePx = fontPx * layer.style.strokeFrac * 2

  // Shadows get its own pre-pass: canvas shadow state applies to every draw,
  // so hanging it off the stroke *and* fill passes below would paint it twice
  // (and line N+1's shadow would land on line N's finished glyphs). Painting
  // the silhouette once underneath, then covering it with the real passes,
  // gives one clean shadow no matter how thick the outline is.
  const shadow = layer.style.shadow
  if (shadow && (shadow.blur > 0 || shadow.dx !== 0 || shadow.dy !== 0)) {
    // shadowBlur/Offset are device-space and ignore the CTM, so scale them by
    // the transform we were handed — that is what keeps preview == export
    const m = ctx.getTransform()
    const s = Math.hypot(m.a, m.b) * doc.height
    ctx.save()
    ctx.shadowColor = shadow.color
    ctx.shadowBlur = shadow.blur * s
    ctx.shadowOffsetX = shadow.dx * s
    ctx.shadowOffsetY = shadow.dy * s
    let shy = y
    if (strokePx > 0.01) {
      ctx.strokeStyle = layer.style.stroke
      ctx.lineWidth = strokePx
      for (const line of lines) {
        ctx.strokeText(line, x, shy)
        shy += lineStep
      }
    } else {
      ctx.fillStyle = layer.style.fill
      for (const line of lines) {
        ctx.fillText(line, x, shy)
        shy += lineStep
      }
    }
    ctx.restore()
  }

  // two passes: every stroke first, then every fill — otherwise a thick
  // outline on line N+1 paints over the fill of line N
  if (strokePx > 0.01) {
    ctx.strokeStyle = layer.style.stroke
    ctx.lineWidth = strokePx
    let sy = y
    for (const line of lines) {
      ctx.strokeText(line, x, sy)
      sy += lineStep
    }
  }
  ctx.fillStyle = layer.style.fill
  for (const line of lines) {
    ctx.fillText(line, x, y)
    y += lineStep
  }
  ctx.restore()
}
