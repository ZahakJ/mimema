// Pure text layout: greedy word wrap + shrink-to-fit. Takes a measure
// function so tests don't need a canvas.

export type Measurer = (text: string, fontPx: number) => number

export type TextLayout = {
  lines: string[]
  fontPx: number
  lineHeight: number
}

export function layoutText(opts: {
  text: string
  boxW: number
  boxH: number
  fontPx: number
  minPx?: number
  lineHeight?: number
  measure: Measurer
}): TextLayout {
  const lineHeight = opts.lineHeight ?? 1.08
  const minPx = opts.minPx ?? 8
  let fontPx = Math.max(opts.fontPx, minPx)

  for (;;) {
    const lines = wrap(opts.text, opts.boxW, fontPx, opts.measure)
    const fitsH = lines.length * fontPx * lineHeight <= opts.boxH
    const fitsW = lines.every((l) => opts.measure(l, fontPx) <= opts.boxW)
    if ((fitsH && fitsW) || fontPx <= minPx) return { lines, fontPx, lineHeight }
    fontPx = Math.max(minPx, fontPx * 0.92)
  }
}

function wrap(text: string, boxW: number, fontPx: number, measure: Measurer): string[] {
  const lines: string[] = []
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push("")
      continue
    }
    let current = words[0]!
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`
      if (measure(candidate, fontPx) <= boxW) current = candidate
      else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }
  return lines
}
