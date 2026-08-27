import { useCallback, useMemo, useState } from "react"
import type { TemplateDto } from "../../shared/schema.ts"
import { SOURCE_LABEL } from "../../shared/schema.ts"
import { useEditor } from "../store/editorStore.ts"

// The rail. Three ways in: what you starred, what you just used, and the
// alphabet soup of everything else. Favorites and recents are per-browser
// courtesies — they live in localStorage and never reach the server.

const FAVORITES_KEY = "mimema:v1:favorites"
const RECENT_KEY = "mimema:v1:recent-templates"
const RECENT_MAX = 8

/** Read a string[] out of localStorage, tolerating absence, junk and lockdown. */
function readIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    return []
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    /* private mode, quota — the picker still works, it just won't remember */
  }
}

export function TemplatePicker({
  templates,
  loading = false,
}: {
  templates: TemplateDto[]
  loading?: boolean
}) {
  const [q, setQ] = useState("")
  const [favorites, setFavorites] = useState<string[]>(() => readIds(FAVORITES_KEY))
  const [recent, setRecent] = useState<string[]>(() => readIds(RECENT_KEY))
  const activeId = useEditor((s) => s.doc?.templateId ?? null)
  const loadTemplate = useEditor((s) => s.loadTemplate)

  const pick = useCallback(
    (t: TemplateDto) => {
      loadTemplate(t)
      setRecent((prev) => {
        const next = [t.id, ...prev.filter((id) => id !== t.id)].slice(0, RECENT_MAX)
        writeIds(RECENT_KEY, next)
        return next
      })
    },
    [loadTemplate],
  )

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [id, ...prev]
      writeIds(FAVORITES_KEY, next)
      return next
    })
  }, [])

  const { starred, recents, yours, classics } = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hit = needle
      ? templates.filter((t) => t.name.toLowerCase().includes(needle))
      : templates
    const byId = new Map(hit.map((t) => [t.id, t]))
    // ordered by the stored list, not by the catalogue — most recent first,
    // and ids whose template has since been deleted simply fall out
    const pluck = (ids: string[]) =>
      ids.map((id) => byId.get(id)).filter((t): t is TemplateDto => t !== undefined)
    return {
      starred: pluck(favorites),
      recents: pluck(recent).filter((t) => !favorites.includes(t.id)),
      yours: hit.filter((t) => t.source !== "imgflip" && t.source !== "memegen"),
      classics: hit.filter((t) => t.source === "imgflip" || t.source === "memegen"),
    }
  }, [templates, q, favorites, recent])

  const shuffle = () => {
    const pool = classics.length + yours.length > 0 ? [...yours, ...classics] : templates
    const choice = pool[Math.floor(Math.random() * pool.length)]
    if (choice) pick(choice)
  }

  const tile = (t: TemplateDto) => {
    const active = t.id === activeId
    const fav = favorites.includes(t.id)
    return (
      <div key={t.id} className={`mm-thumb${active ? " mm-thumb--active" : ""}`}>
        <button className="mm-thumb__pick" onClick={() => pick(t)} title={t.name}>
          <span className="mm-thumb__imgbox">
            <img src={t.imageUrl} alt="" loading="lazy" />
          </span>
          <span className="mm-thumb__name">{t.name}</span>
        </button>
        <span className="mm-thumb__zones" title={`${t.zones.length} text zones`}>
          {t.zones.length}◱
        </span>
        <button
          className={`mm-thumb__star${fav ? " mm-thumb__star--on" : ""}`}
          onClick={() => toggleFavorite(t.id)}
          aria-pressed={fav}
          title={fav ? "unstar" : "star this template"}
        >
          {fav ? "★" : "☆"}
        </button>
        {active && t.sourceUrl && (
          <a
            className="mm-thumb__via"
            href={t.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={t.sourceUrl}
          >
            via {SOURCE_LABEL[t.source]} ↗
          </a>
        )}
      </div>
    )
  }

  const bucket = (label: string, list: TemplateDto[]) =>
    list.length > 0 && (
      <>
        <div className="mm-picker__head">
          {label} <span className="mm-picker__count">{list.length}</span>
        </div>
        <div className="mm-picker__grid">{list.map(tile)}</div>
      </>
    )

  return (
    <aside className="mm-picker">
      <div className="mm-picker__top">
        <div className="ms-search">
          <span className="ms-search__icon">⌕</span>
          <input placeholder="find a template…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="ms-btn ms-btn--icon mm-dice" onClick={shuffle} title="random template">
          🎲
        </button>
      </div>
      <div className="mm-picker__scroll">
        {loading && (
          <>
            <div className="mm-picker__head">
              the classics <span className="mm-picker__count">…</span>
            </div>
            <div className="mm-picker__grid" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="mm-thumb mm-skel mm-skel--thumb" />
              ))}
            </div>
          </>
        )}
        {bucket("starred", starred)}
        {bucket("just used", recents)}
        {bucket("yours", yours)}
        {bucket("the classics", classics)}
        {!loading && yours.length + classics.length === 0 && (
          <div className="ms-empty">
            <div className="ms-empty__title">no template matches</div>
            <div>
              make your own in <a href="#/add-template">New Template</a>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
