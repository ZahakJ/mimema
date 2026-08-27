import { useMemo } from "react"
import { Marked } from "marked"
import whitepaper from "../../WHITEPAPER.md?raw"

// The paper is ours and static, but raw HTML in markdown is never rendered —
// defense in depth, same posture as refusing SVG uploads.
const md = new Marked({ gfm: true })
md.use({ tokenizer: { html: () => undefined, tag: () => undefined } })

export function PaperView() {
  const html = useMemo(
    () =>
      md
        .parse(whitepaper, { async: false })
        .replaceAll("<table>", '<div class="mm-paper__wide"><table>')
        .replaceAll("</table>", "</table></div>")
        // a paragraph opening with a superscript digit is a footnote
        .replaceAll(/<p>(?=[¹²³⁴⁵⁶⁷⁸⁹])/g, '<p class="mm-paper__fn">'),
    [],
  )

  return (
    <div className="mm-paper">
      <article className="mm-paper__doc" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="mm-paper__colophon">
        <a href="#/">← back to the forge</a> · <a href="#/wall">the wall</a> · per Criterion 6.3,
        reading this is not enough
      </div>
    </div>
  )
}
