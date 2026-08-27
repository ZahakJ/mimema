import { useState } from "react"
import { TAGS_PER_ITEM, slugifyTag } from "../../shared/schema.ts"

/** Chip editor for item tags. Enter or comma commits, backspace on an empty
 *  field eats the last chip. Slugification is live so what you see is what the
 *  server will store. */
export function TagInput({
  tags,
  onChange,
  placeholder = "tags (enter to add)",
  autoFocus,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState("")
  const full = tags.length >= TAGS_PER_ITEM

  const commit = (raw: string) => {
    const tag = slugifyTag(raw)
    setDraft("")
    if (!tag || full || tags.includes(tag)) return
    onChange([...tags, tag])
  }

  return (
    <div className="mm-tags mm-tags--edit">
      {tags.map((tag) => (
        <span key={tag} className="mm-tag mm-tag--chip">
          #{tag}
          <button
            type="button"
            className="mm-tag__x"
            aria-label={`remove ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        className="mm-tags__input"
        value={draft}
        autoFocus={autoFocus}
        maxLength={40}
        placeholder={full ? `${TAGS_PER_ITEM} tags is the limit` : placeholder}
        disabled={full}
        onChange={(e) => {
          // the comma key is caught below; this catches a pasted "a,b,c"
          const parts = e.target.value.split(",")
          if (parts.length > 1) {
            let next = tags
            for (const part of parts.slice(0, -1)) {
              const tag = slugifyTag(part)
              if (tag && next.length < TAGS_PER_ITEM && !next.includes(tag)) next = [...next, tag]
            }
            if (next !== tags) onChange(next)
          }
          setDraft(parts[parts.length - 1]!)
        }}
        onBlur={() => draft && commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            commit(draft)
          } else if (e.key === "Backspace" && draft === "" && tags.length) {
            e.preventDefault()
            onChange(tags.slice(0, -1))
          }
        }}
      />
      {draft.trim() && slugifyTag(draft) !== draft.trim() && (
        <span className="mm-tags__ghost">→ #{slugifyTag(draft) || "…"}</span>
      )}
    </div>
  )
}
