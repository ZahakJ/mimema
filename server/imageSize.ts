// Minimal image dimension probing — enough for masonry layout and template
// metadata without a native imaging dependency. Video dims stay null.

/** headers can claim absurd dimensions (decoder bomb); nothing real needs more */
export const DIM_MAX = 20000

export function imageSize(buf: Uint8Array, ext: string): { width: number; height: number } | null {
  switch (ext) {
    case "png":
      return pngSize(buf)
    case "jpg":
      return jpegSize(buf)
    case "gif":
      return gifSize(buf)
    case "webp":
      return webpSize(buf)
    default:
      return null
  }
}

function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null
  return { width: be32(buf, 16), height: be32(buf, 20) }
}

function gifSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 10) return null
  return { width: le16(buf, 6), height: le16(buf, 8) }
}

function jpegSize(buf: Uint8Array): { width: number; height: number } | null {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null
    const marker = buf[i + 1]!
    // SOF0..SOF15 minus DHT(C4)/JPG(C8)/DAC(CC) carry the frame header
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: be16(buf, i + 7), height: be16(buf, i + 5) }
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2
      continue
    }
    i += 2 + be16(buf, i + 2)
  }
  return null
}

function webpSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 30) return null
  const chunk = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!)
  if (chunk === "VP8X") {
    return {
      width: 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)),
      height: 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)),
    }
  }
  if (chunk === "VP8 ") {
    // lossy: 3-byte start code 9d 01 2a, then 14-bit dims
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null
    return { width: le16(buf, 26) & 0x3fff, height: le16(buf, 28) & 0x3fff }
  }
  if (chunk === "VP8L") {
    if (buf[20] !== 0x2f) return null
    const b1 = buf[21]!, b2 = buf[22]!, b3 = buf[23]!, b4 = buf[24]!
    return {
      width: (((b2 & 0x3f) << 8) | b1) + 1,
      height: (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)) + 1,
    }
  }
  return null
}

function be32(b: Uint8Array, i: number): number {
  return (b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!
}
function be16(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!
}
function le16(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8)
}
