import { useCallback, useEffect, useRef, useState } from "react"
import type { ItemDto, ItemPage, ItemSort, TagCountDto, TemplateDto } from "../../shared/schema.ts"
import { ITEM_SORTS, REACTION_EMOJI } from "../../shared/schema.ts"
import { api } from "../api/client.ts"
import { useAuth } from "../store/authStore.ts"
import { toast } from "../components/Toasts.tsx"
import { Lightbox } from "./Lightbox.tsx"

const SORT_LABEL: Record<ItemSort, string> = {
  new: "newest first",
  old: "oldest first",
  top: "most reacted",
}

export function GalleryView() {
  const verified = useAuth((s) => s.verified)
  const [items, setItems] = useState<ItemDto[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [template, setTemplate] = useState("")
  const [tag, setTag] = useState("")
  const [sort, setSort] = useState<ItemSort>("new")
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [tagCloud, setTagCloud] = useState<TagCountDto[]>([])
  const [shuffled, setShuffled] = useState(false)
  const [open, setOpen] = useState<ItemDto | null>(null)
  const [dragging, setDragging] = useState(0)
  const queryRef = useRef({ q: "", template: "", tag: "", sort: "new" as ItemSort })

  const refreshTags = useCallback(() => {
    api.listTags().then(setTagCloud, () => {})
  }, [])

  const fetchPage = useCallback(async (reset: boolean, cur?: string | null) => {
    setLoading(true)
    try {
      const page: ItemPage = await api.listItems({
        q: queryRef.current.q || undefined,
        template: queryRef.current.template || undefined,
        tag: queryRef.current.tag || undefined,
        sort: queryRef.current.sort,
        cursor: reset ? undefined : cur ?? undefined,
        limit: 60,
      })
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]))
      setCursor(page.nextCursor)
      setShuffled(false)
    } catch {
      toast("Could not load the wall", "danger")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPage(true)
    api.listTemplates().then(setTemplates, () => {})
    refreshTags()
  }, [fetchPage, refreshTags])

  // debounce search
  useEffect(() => {
    queryRef.current = { q, template, tag, sort }
    const t = setTimeout(() => void fetchPage(true), q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, template, tag, sort, fetchPage])

  const shuffle = () => {
    setItems((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j]!, next[i]!]
      }
      return next
    })
    setShuffled(true)
  }

  /** one item changed on the server — mirror it wherever it's on screen */
  const applyUpdate = useCallback((next: ItemDto) => {
    setItems((prev) => prev.map((i) => (i.slug === next.slug ? next : i)))
    setOpen((cur) => (cur && cur.slug === next.slug ? next : cur))
  }, [])

  const uploadFiles = async (files: File[]) => {
    if (!verified) {
      toast("Enter the invite key to upload", "warn")
      return
    }
    for (const file of files) {
      try {
        const item = await api.uploadItem(file, { kind: "upload", filename: file.name })
        setItems((prev) => (prev.some((i) => i.slug === item.slug) ? prev : [item, ...prev]))
        if (item.deduped) {
          toast("already on the wall — took you to the original", "warn")
          setOpen(item)
        } else {
          toast(`${item.slug} is on the wall`)
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : "Upload failed", "danger")
      }
    }
  }

  const removed = (slug: string) => {
    setItems((prev) => prev.filter((i) => i.slug !== slug))
    setOpen(null)
    refreshTags()
  }

  return (
    <div
      className="mm-wall"
      onDragEnter={(e) => {
        e.preventDefault()
        setDragging((d) => d + 1)
      }}
      onDragLeave={() => setDragging((d) => Math.max(0, d - 1))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(0)
        void uploadFiles([...e.dataTransfer.files])
      }}
    >
      <div className="mm-wall__bar">
        <div className="ms-search">
          <input placeholder="search the wall…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select
          className="mm-wall__filter mm-field-select"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          aria-label="filter by template"
        >
          <option value="">every template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className="mm-field-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as ItemSort)}
          aria-label="sort order"
        >
          {ITEM_SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>
        <button className={`ms-btn${shuffled ? " ms-btn--active" : ""}`} onClick={shuffle}>
          🎲 shuffle
        </button>
        <label className="ms-btn" title={verified ? "host any image/gif/video" : "needs the invite key"}>
          ⇪ upload
          <input
            type="file"
            hidden
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
            onChange={(e) => {
              void uploadFiles([...(e.target.files ?? [])])
              e.target.value = ""
            }}
          />
        </label>
        <span className="mm-wall__count">
          {items.length}
          {cursor ? "+" : ""} artifact{items.length === 1 && !cursor ? "" : "s"}
        </span>
      </div>

      {(tagCloud.length > 0 || tag) && (
        <div className="mm-tagbar">
          {tag && (
            <button className="mm-tag mm-tag--active" onClick={() => setTag("")}>
              #{tag} <span className="mm-tag__x">✕</span>
            </button>
          )}
          {tagCloud
            .filter((t) => t.tag !== tag)
            .slice(0, 24)
            .map((t) => (
              <button key={t.tag} className="mm-tag" onClick={() => setTag(t.tag)}>
                #{t.tag}
                <span className="mm-tag__n">{t.count}</span>
              </button>
            ))}
        </div>
      )}

      {items.length === 0 && loading ? (
        <div className="mm-masonry" aria-hidden="true">
          {SKELETON_RATIOS.map((r, i) => (
            <div key={i} className="mm-skel mm-skel--card" style={{ aspectRatio: r }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="ms-empty" style={{ paddingTop: "18vh" }}>
          <div className="mm-editor__glyph">▦</div>
          <div className="ms-empty__title">
            {tag || q ? "nothing matches that" : "the wall awaits its first artifact"}
          </div>
          <div>
            <a href="#/">go forge something</a>
          </div>
        </div>
      ) : (
        <div className="mm-masonry">
          {items.map((item, i) => (
            <Card
              key={item.slug}
              item={item}
              index={i}
              onOpen={() => setOpen(item)}
              onTag={setTag}
            />
          ))}
        </div>
      )}

      {cursor && (
        <div className="mm-wall__more">
          <button className="ms-btn" disabled={loading} onClick={() => void fetchPage(false, cursor)}>
            {loading ? "loading…" : "more artifacts ↓"}
          </button>
        </div>
      )}

      {dragging > 0 && <div className="mm-drop">drop to host it here</div>}
      {open && (
        <Lightbox
          // per-item state (spent reactions, edit draft) must not survive a
          // switch to a different artifact
          key={open.slug}
          item={open}
          onClose={() => setOpen(null)}
          onDeleted={removed}
          onUpdated={(next) => {
            applyUpdate(next)
            refreshTags()
          }}
          onTag={(t) => {
            setTag(t)
            setOpen(null)
          }}
        />
      )}
    </div>
  )
}

// a masonry of identical rectangles reads as a bug — vary the footprints
const SKELETON_RATIOS = ["4 / 5", "1 / 1", "3 / 4", "16 / 10", "4 / 5", "1 / 1", "3 / 5", "5 / 4", "1 / 1", "4 / 3", "3 / 4", "16 / 9"]

function Card({
  item,
  index,
  onOpen,
  onTag,
}: {
  item: ItemDto
  index: number
  onOpen: () => void
  onTag: (tag: string) => void
}) {
  const isVideo = item.mime.startsWith("video/")
  // reserve the real footprint before the media loads — no layout shift,
  // no stretched pictures
  const ratio =
    item.width && item.height ? `${item.width} / ${item.height}` : isVideo ? "16 / 9" : undefined
  const total = Object.values(item.reactions).reduce((a, b) => a + b, 0)
  const faces = REACTION_EMOJI.filter((e) => item.reactions[e])
  return (
    <div className="mm-card" style={{ animationDelay: `${Math.min(index % 24, 16) * 24}ms` }}>
      <button className="mm-card__media" onClick={onOpen} aria-label={`open ${item.title || item.slug}`}>
        {isVideo ? (
          <video
            src={item.url}
            style={ratio ? { aspectRatio: ratio } : undefined}
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              if (v.videoWidth && v.videoHeight)
                v.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`
            }}
            onMouseEnter={(e) => void e.currentTarget.play()}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        ) : (
          <img
            src={item.url}
            alt={item.title || item.slug}
            loading="lazy"
            style={ratio ? { aspectRatio: ratio } : undefined}
          />
        )}
      </button>
      <span className="mm-card__bar">
        <button className="mm-card__title" onClick={onOpen}>
          {item.title || item.slug}
        </button>
        {total > 0 && (
          <span className="mm-card__reacts" title={`${total} reaction${total === 1 ? "" : "s"}`}>
            {faces.join("")} {total}
          </span>
        )}
        <span className="mm-card__badge" title={isVideo ? "video" : item.kind === "meme" ? "forged here" : "hosted upload"}>
          {isVideo ? "▶" : item.kind === "meme" ? "◈" : "▣"}
        </span>
      </span>
      {item.tags.length > 0 && (
        <span className="mm-tags mm-card__tags">
          {item.tags.map((t) => (
            <button key={t} className="mm-tag" onClick={() => onTag(t)}>
              #{t}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}
