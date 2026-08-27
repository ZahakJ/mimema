// Export re-renders at native template resolution through the same
// renderMeme path as the preview.
import type { MemeDoc } from "../../shared/schema.ts"
import { renderMeme, type Assets } from "./renderMeme.ts"
import { deepFry } from "./deepFry.ts"

export async function exportPng(doc: MemeDoc, baseUrl: string | null): Promise<Blob> {
  const assets: Assets = { base: null, stickers: new Map() }
  const loads: Promise<void>[] = []
  if (baseUrl) {
    loads.push(
      loadImage(baseUrl).then((img) => {
        assets.base = img
      }),
    )
  }
  for (const layer of doc.layers) {
    if (layer.type === "sticker") {
      loads.push(
        loadImage(layer.src).then((img) => {
          assets.stickers.set(layer.id, img)
        }),
      )
    }
  }
  await Promise.all(loads)

  const canvas = document.createElement("canvas")
  canvas.width = doc.width
  canvas.height = doc.height
  renderMeme(canvas.getContext("2d")!, doc, assets)
  if (doc.deepFry) await deepFry(canvas)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
  })
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${src.slice(0, 64)}`))
    img.src = src
  })
}
