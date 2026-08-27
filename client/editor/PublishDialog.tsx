import { useState } from "react"
import { useEditor } from "../store/editorStore.ts"
import { useAuth } from "../store/authStore.ts"
import { api } from "../api/client.ts"
import { exportPng } from "./exportPng.ts"
import { toast } from "../components/Toasts.tsx"
import { InviteKeyDialog } from "../components/InviteKeyDialog.tsx"
import { Portal } from "../components/Portal.tsx"
import { TagInput } from "../components/TagInput.tsx"
import type { ItemDto } from "../../shared/schema.ts"

export function PublishDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)
  const template = useEditor((s) => s.template)
  const verified = useAuth((s) => s.verified)
  const [title, setTitle] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState<"download" | "copy" | "publish" | null>(null)
  const [published, setPublished] = useState<ItemDto | null>(null)
  const [keyOpen, setKeyOpen] = useState(false)

  if (!doc) return null

  const render = () => exportPng(doc, template?.imageUrl ?? null)

  const download = async () => {
    setBusy("download")
    try {
      const blob = await render()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `${(title.trim() || template?.id || "meme").replaceAll(/\s+/g, "-")}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      toast("Export failed", "danger")
    } finally {
      setBusy(null)
    }
  }

  // Chromium is the target; Firefox has no image ClipboardItem yet. The blob
  // goes in as a promise so the write stays inside the user gesture.
  const copyPng = async () => {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      toast("This browser can't copy images — download instead", "warn")
      return
    }
    setBusy("copy")
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": render() })])
      toast("PNG on your clipboard ⧉")
    } catch {
      toast("Copy failed — download instead", "warn")
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    setBusy("publish")
    try {
      const blob = await render()
      const item = await api.uploadItem(blob, {
        kind: "meme",
        title: title.trim(),
        templateId: template?.id,
        filename: "meme.png",
        tags,
      })
      setPublished(item)
      toast(item.deduped ? "already on the wall — took you to the original" : "On the wall ◈")
    } catch (err) {
      toast(err instanceof Error ? err.message : "Publish failed", "danger")
    } finally {
      setBusy(null)
    }
  }

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text)
    toast("Copied")
  }

  return (
    <Portal>
    <div className="mm-scrim" onClick={onClose}>
      <div className="mm-dialog ms-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ms-panel__header">{published ? "It lives" : "Ship your meme"}</div>
        <div className="ms-panel__body mm-dialog__body">
          {!published ? (
            <>
              <div className="ms-search">
                <input
                  placeholder="title (optional, searchable on the wall)"
                  value={title}
                  autoFocus
                  maxLength={140}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && onClose()}
                />
              </div>
              <TagInput tags={tags} onChange={setTags} />
              {doc.deepFry && <div className="mm-dialog__hint">🍟 will be deep-fried on export</div>}
              <div className="mm-dialog__row">
                <button className="ms-btn" disabled={busy !== null} onClick={() => void download()}>
                  {busy === "download" ? "Rendering…" : "⇩ Download PNG"}
                </button>
                <button className="ms-btn" disabled={busy !== null} onClick={() => void copyPng()}>
                  {busy === "copy" ? "Copying…" : "⧉ Copy PNG"}
                </button>
                <div style={{ flex: 1 }} />
                {verified ? (
                  <button
                    className="ms-btn ms-btn--primary"
                    disabled={busy !== null}
                    onClick={() => void publish()}
                  >
                    {busy === "publish" ? "Publishing…" : "◈ Publish to the wall"}
                  </button>
                ) : (
                  <button className="ms-btn" onClick={() => setKeyOpen(true)}>
                    ◇ unlock publishing
                  </button>
                )}
              </div>
              {!verified && (
                <div className="mm-dialog__hint">
                  Forging and downloading are free — publishing to the wall and uploading media
                  need the shared invite key.
                </div>
              )}
            </>
          ) : (
            <>
              <img className="mm-dialog__preview" src={published.url} alt={published.title || published.slug} />
              <div className="mm-dialog__hint mono">{published.slug}</div>
              <div className="mm-dialog__row">
                <button
                  className="ms-btn"
                  onClick={() => copy(`${location.origin}${published.url}`)}
                >
                  copy image URL
                </button>
                <button
                  className="ms-btn"
                  onClick={() => copy(`${location.origin}${published.shareUrl}`)}
                >
                  copy share link
                </button>
                <div style={{ flex: 1 }} />
                <a className="ms-btn ms-btn--primary" href="#/wall" onClick={onClose}>
                  see the wall →
                </a>
              </div>
            </>
          )}
        </div>
      </div>
      {keyOpen && <InviteKeyDialog onClose={() => setKeyOpen(false)} />}
    </div>
    </Portal>
  )
}
