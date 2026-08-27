import { useEffect, useRef, useState } from "react"
import type { ItemDto } from "../../shared/schema.ts"
import { REACTION_EMOJI } from "../../shared/schema.ts"
import { api } from "../api/client.ts"
import { useAuth } from "../store/authStore.ts"
import { toast } from "../components/Toasts.tsx"
import { Portal } from "../components/Portal.tsx"
import { TagInput } from "../components/TagInput.tsx"
import { markReacted, reactedWith } from "./reactions.ts"

export function Lightbox({
  item,
  onClose,
  onDeleted,
  onUpdated,
  onTag,
}: {
  item: ItemDto
  onClose: () => void
  onDeleted: (slug: string) => void
  onUpdated: (item: ItemDto) => void
  onTag: (tag: string) => void
}) {
  const verified = useAuth((s) => s.verified)
  const isVideo = item.mime.startsWith("video/")
  // delete asks in place — no native confirm() breaking the spell
  const [confirming, setConfirming] = useState(false)
  const [spent, setSpent] = useState<string[]>(() => reactedWith(item.slug))
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [tags, setTags] = useState<string[]>(item.tags)
  const [saving, setSaving] = useState(false)
  const armRef = useRef<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => () => void (armRef.current && clearTimeout(armRef.current)), [])

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text)
    toast(`${label} copied`)
  }

  const arm = () => {
    setConfirming(true)
    if (armRef.current) clearTimeout(armRef.current)
    armRef.current = window.setTimeout(() => setConfirming(false), 3000)
  }

  const del = async () => {
    if (armRef.current) clearTimeout(armRef.current)
    setConfirming(false)
    try {
      await api.deleteItem(item.slug)
      toast("Gone")
      onDeleted(item.slug)
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "danger")
    }
  }

  const react = async (emoji: string) => {
    if (spent.includes(emoji)) return
    setSpent((prev) => [...prev, emoji])
    markReacted(item.slug, emoji)
    // optimistic — the count is decoration, not truth
    onUpdated({
      ...item,
      reactions: { ...item.reactions, [emoji]: (item.reactions[emoji] ?? 0) + 1 },
    })
    try {
      const res = await api.react(item.slug, emoji)
      onUpdated({ ...item, reactions: res.reactions })
    } catch (err) {
      toast(err instanceof Error ? err.message : "Reaction failed", "danger")
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      onUpdated(await api.patchItem(item.slug, { title: title.trim(), tags }))
      setEditing(false)
      toast("Updated")
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "danger")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Portal>
    <div className="mm-light" onClick={onClose}>
      <button
        className="ms-btn ms-btn--icon mm-light__close"
        aria-label="close"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        ✕
      </button>
      {isVideo ? (
        <video
          className="mm-light__media"
          src={item.url}
          controls
          autoPlay
          loop
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img
          className="mm-light__media"
          src={item.url}
          alt={item.title || item.slug}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {editing ? (
        <div className="mm-light__edit" onClick={(e) => e.stopPropagation()}>
          <div className="ms-search">
            <input
              placeholder="title"
              value={title}
              autoFocus
              maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
            />
          </div>
          <TagInput tags={tags} onChange={setTags} />
          <div className="mm-light__row">
            <button className="ms-btn ms-btn--primary" disabled={saving} onClick={() => void save()}>
              {saving ? "saving…" : "save"}
            </button>
            <button
              className="ms-btn"
              disabled={saving}
              onClick={() => {
                setTitle(item.title)
                setTags(item.tags)
                setEditing(false)
              }}
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mm-light__title">{item.title || item.slug}</div>
          {item.tags.length > 0 && (
            <div className="mm-tags" onClick={(e) => e.stopPropagation()}>
              {item.tags.map((t) => (
                <button key={t} className="mm-tag" onClick={() => onTag(t)}>
                  #{t}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mm-light__reacts" onClick={(e) => e.stopPropagation()}>
        {REACTION_EMOJI.map((emoji) => {
          const used = spent.includes(emoji)
          return (
            <button
              key={emoji}
              className={`mm-react${used ? " mm-react--used" : ""}`}
              disabled={used}
              title={used ? "you already reacted with this" : `react ${emoji}`}
              onClick={() => void react(emoji)}
            >
              <span className="mm-react__face">{emoji}</span>
              <span className="mm-react__n">{item.reactions[emoji] ?? 0}</span>
            </button>
          )
        })}
      </div>

      <div className="mm-light__row" onClick={(e) => e.stopPropagation()}>
        <a
          className="ms-btn ms-btn--primary"
          href={item.url}
          download={`${item.title.trim().replaceAll(/\s+/g, "-") || item.slug}.${item.ext}`}
        >
          ⇩ download
        </a>
        <button className="ms-btn" onClick={() => copy(`${location.origin}${item.url}`, "image URL")}>
          copy direct URL
        </button>
        <button
          className="ms-btn"
          onClick={() => copy(`${location.origin}${item.shareUrl}`, "share link")}
        >
          copy share link
        </button>
        <a className="ms-btn" href={item.shareUrl} target="_blank" rel="noreferrer">
          open share page ↗
        </a>
        {item.templateId && (
          <a className="ms-btn" href={`#/edit/${item.templateId}`} onClick={onClose}>
            remix this template ◱
          </a>
        )}
        {verified && !editing && (
          <button
            className="ms-btn"
            onClick={() => {
              setTitle(item.title)
              setTags(item.tags)
              setEditing(true)
            }}
          >
            ✎ edit
          </button>
        )}
        {verified && (
          <button
            className={`ms-btn ms-btn--danger${confirming ? " mm-light__armed" : ""}`}
            onClick={() => (confirming ? void del() : arm())}
          >
            {confirming ? "really delete?" : "delete"}
          </button>
        )}
      </div>
    </div>
    </Portal>
  )
}
