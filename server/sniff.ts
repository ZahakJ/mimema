// Magic-byte MIME detection. The client-declared content type is never
// trusted; what this module says is what gets stored and served. SVG is
// deliberately absent (scriptable XML → XSS on a hotlinkable host).

export type Sniffed = {
  mime: string
  ext: string
  kind: "image" | "video"
}

export function sniff(buf: Uint8Array): Sniffed | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: "image/png", ext: "png", kind: "image" }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg", kind: "image" }
  }
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") {
    return { mime: "image/gif", ext: "gif", kind: "image" }
  }
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp", kind: "image" }
  }
  if (ascii(buf, 4, 8) === "ftyp") {
    // ISO-BMFF is a container family: AVIF/HEIC/MOV/3GP share the ftyp box.
    // Only the whitelisted major brands are mp4; everything else is rejected
    // rather than stored under a lying .mp4 extension.
    const brand = ascii(buf, 8, 12)
    return MP4_BRANDS.has(brand) ? { mime: "video/mp4", ext: "mp4", kind: "video" } : null
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { mime: "video/webm", ext: "webm", kind: "video" }
  }
  return null
}

// mp4-compatible major brands. M4V variants play as video/mp4; the explicitly
// rejected image brands (avif/avis/heic/heix/hevc/mif1) simply aren't here.
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "dash",
  "M4V ",
  "M4VH",
  "M4VP",
])

export const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
}

function ascii(buf: Uint8Array, from: number, to: number): string {
  let s = ""
  for (let i = from; i < to; i++) s += String.fromCharCode(buf[i]!)
  return s
}
