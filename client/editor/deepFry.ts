// The deep fryer: crank saturation/contrast, sprinkle RGB noise, then run the
// result through two brutal JPEG re-encodes. Mutates the canvas in place.

export async function deepFry(canvas: HTMLCanvasElement): Promise<void> {
  const ctx = canvas.getContext("2d")!

  // pass 1 — cook the colors
  const cooked = document.createElement("canvas")
  cooked.width = canvas.width
  cooked.height = canvas.height
  const cctx = cooked.getContext("2d")!
  cctx.filter = "saturate(2.6) contrast(2.1) brightness(1.12)"
  cctx.drawImage(canvas, 0, 0)

  // pass 2 — grease spatter
  const img = cctx.getImageData(0, 0, cooked.width, cooked.height)
  const d = img.data
  let seed = 0x9e3779b9
  const rand = () => {
    // cheap xorshift — deterministic fry per pixel count
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return ((seed >>> 0) / 0xffffffff - 0.5) * 2
  }
  for (let i = 0; i < d.length; i += 4) {
    const n = rand() * 26
    d[i] = clamp(d[i]! + n + 10)
    d[i + 1] = clamp(d[i + 1]! + rand() * 26)
    d[i + 2] = clamp(d[i + 2]! + rand() * 26 - 8)
  }
  cctx.putImageData(img, 0, 0)

  // pass 3 — two rounds of quality-0.25 JPEG
  for (let round = 0; round < 2; round++) {
    const url = cooked.toDataURL("image/jpeg", 0.25)
    await drawFromUrl(cctx, url)
  }

  ctx.drawImage(cooked, 0, 0)
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function drawFromUrl(ctx: CanvasRenderingContext2D, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0)
      resolve()
    }
    img.onerror = () => reject(new Error("deep fry failed"))
    img.src = url
  })
}
