import { useEffect, useRef, useState } from "react"
import { api } from "../api/client.ts"
import { useAuth } from "../store/authStore.ts"
import { navigate } from "../router.ts"
import { usePhone } from "../usePhone.ts"
import { toast } from "../components/Toasts.tsx"
import { InviteKeyDialog } from "../components/InviteKeyDialog.tsx"
import { applyDrag, applyResize, HANDLES, type FracRect, type Handle } from "../editor/interactions.ts"
import { loadImage } from "../editor/exportPng.ts"
import { ZONES_MAX } from "../../shared/schema.ts"

type DraftZone = FracRect & { id: string }

type Gesture =
  | { type: "create"; id: string; startX: number; startY: number }
  | { type: "move"; id: string; lastX: number; lastY: number }
  | { type: "resize"; id: string; handle: Handle; lastX: number; lastY: number }

/** The fontFrac every saved zone gets — the preview mirrors it so what you see
 *  fitting here is what the forge will render. */
const PREVIEW_FONT_FRAC = 0.1
const PREVIEW_STROKE_FRAC = 0.08

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
}

function isHandle(value: string | undefined): value is Handle {
  return HANDLES.some((h) => h.handle === value)
}

// Turn any image into a template: drop it in, drag out the text zones,
// name it, and jump straight into the forge with it.
export function ZoneEditorView() {
  const verified = useAuth((s) => s.verified)
  const phone = usePhone()
  const [file, setFile] = useState<File | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [dims, setDims] = useState({ w: 1, h: 1 })
  const [zones, setZones] = useState<DraftZone[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [dragging, setDragging] = useState(0)
  const [frameH, setFrameH] = useState(0)
  const gestureRef = useRef<Gesture | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const srcRef = useRef<string | null>(null)
  const full = zones.length >= ZONES_MAX

  // object URLs are leaks with a nice name — drop the old one on every swap
  useEffect(() => () => void (srcRef.current && URL.revokeObjectURL(srcRef.current)), [])

  // The placeholder preview sizes off the rendered frame, not the native image:
  // fontFrac is a fraction of image height, and the frame is that image scaled.
  useEffect(() => {
    const el = stageRef.current
    if (!el) {
      setFrameH(0)
      return
    }
    const ro = new ResizeObserver(([entry]) => setFrameH(entry?.contentRect.height ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [src])

  // Delete drops the selected zone — but not while the name field has focus,
  // where Delete/Backspace obviously belongs to the text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      if (!selected) return
      e.preventDefault()
      setZones((z) => z.filter((x) => x.id !== selected))
      setSelected(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected])

  const pick = async (f: File) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) {
      toast("Templates must be png/jpeg/webp/gif", "warn")
      return
    }
    const url = URL.createObjectURL(f)
    const img = await loadImage(url).catch(() => null)
    if (!img) {
      URL.revokeObjectURL(url)
      toast("That image would not decode", "danger")
      return
    }
    if (srcRef.current) URL.revokeObjectURL(srcRef.current)
    srcRef.current = url
    setFile(f)
    setSrc(url)
    setDims({ w: img.naturalWidth, h: img.naturalHeight })
    setZones([])
    setSelected(null)
    if (!name) setName(f.name.replace(/\.[a-z0-9]+$/i, "").replaceAll(/[-_]+/g, " "))
  }

  const toFrac = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect()
    return {
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!src) return
    const target = e.target as HTMLElement
    const p = toFrac(e)
    const zoneId = target.dataset.zone
    const handle = target.dataset.handle

    if (zoneId && isHandle(handle)) {
      gestureRef.current = { type: "resize", id: zoneId, handle, lastX: p.x, lastY: p.y }
      setSelected(zoneId)
    } else if (zoneId) {
      gestureRef.current = { type: "move", id: zoneId, lastX: p.x, lastY: p.y }
      setSelected(zoneId)
    } else {
      // the schema caps zones at ZONES_MAX; refuse here rather than fail on save
      if (full) return
      const id = Math.random().toString(36).slice(2, 8)
      setZones((z) => [...z, { id, x: p.x, y: p.y, w: 0.001, h: 0.001, angle: 0 }])
      setSelected(id)
      gestureRef.current = { type: "create", id, startX: p.x, startY: p.y }
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g) return
    const p = toFrac(e)
    setZones((zs) =>
      zs.map((z) => {
        if (z.id !== g.id) return z
        if (g.type === "create") {
          return {
            ...z,
            x: Math.min(g.startX, p.x),
            y: Math.min(g.startY, p.y),
            w: Math.abs(p.x - g.startX),
            h: Math.abs(p.y - g.startY),
          }
        }
        if (g.type === "move") {
          const moved = { ...z, ...applyDrag(z, p.x - g.lastX, p.y - g.lastY) }
          g.lastX = p.x
          g.lastY = p.y
          return moved
        }
        const resized = {
          ...z,
          ...applyResize(z, g.handle, p.x - g.lastX, p.y - g.lastY, dims.w / dims.h),
        }
        g.lastX = p.x
        g.lastY = p.y
        return resized
      }),
    )
  }

  const onPointerUp = () => {
    const g = gestureRef.current
    gestureRef.current = null
    if (g?.type === "create") {
      // discard accidental clicks that never became a rectangle
      setZones((zs) => zs.filter((z) => z.id !== g.id || (z.w > 0.03 && z.h > 0.03)))
    }
  }

  const save = async () => {
    if (!file || zones.length === 0 || !name.trim()) return
    setBusy(true)
    try {
      const tpl = await api.createTemplate(file, {
        name: name.trim(),
        zones: zones.map((z, i) => ({
          x: z.x,
          y: z.y,
          w: z.w,
          h: z.h,
          align: "center" as const,
          valign: "middle" as const,
          angle: 0,
          style: {
            fontFamily: "Anton" as const,
            fontFrac: 0.1,
            fill: "#ffffff",
            stroke: "#000000",
            strokeFrac: 0.08,
            allCaps: true,
          },
          placeholder: `TEXT ${i + 1}`,
        })),
      })
      toast(`Template "${tpl.name}" saved`)
      navigate(`#/edit/${tpl.id}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "danger")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`mm-zone${src ? "" : " mm-zone--empty"}`}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragging((d) => d + 1)
      }}
      onDragLeave={() => setDragging((d) => Math.max(0, d - 1))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(0)
        const f = e.dataTransfer.files[0]
        if (f) void pick(f)
      }}
    >
      <div className="mm-zone__side ms-panel">
        <div className="ms-panel__header">New template</div>
        <div className="ms-panel__body mm-zone__controls">
          <label className="ms-btn mm-wide">
            {file ? "swap image" : "choose an image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void pick(f)
                e.target.value = ""
              }}
            />
          </label>
          <div className="ms-search">
            <input
              placeholder="template name (e.g. Wait What)"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="mm-inspector__hint">
            {!src
              ? "any screenshot works — that one frame from that one show, for instance"
              : full
                ? `that's the lot — ${ZONES_MAX} zones is the ceiling. delete one to draw another.`
                : "drag on the image to draw text zones — drag a zone to move it, any handle to resize, Delete to remove it"}
          </div>
          {zones.length > 0 && (
            <div className="mm-inspector__hint mono">
              {zones.length}/{ZONES_MAX} zone{zones.length === 1 ? "" : "s"}
              {selected && (
                <button
                  className="ms-btn ms-btn--danger"
                  style={{ marginLeft: 8 }}
                  onClick={() => {
                    setZones((z) => z.filter((x) => x.id !== selected))
                    setSelected(null)
                  }}
                >
                  delete selected
                </button>
              )}
            </div>
          )}
          {verified ? (
            <button
              className="ms-btn ms-btn--primary mm-wide"
              disabled={busy || !file || zones.length === 0 || !name.trim()}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save & forge with it →"}
            </button>
          ) : (
            <button className="ms-btn mm-wide" onClick={() => setKeyOpen(true)}>
              ◇ unlock with the invite key
            </button>
          )}
        </div>
      </div>

      <div className="mm-zone__stage">
        {src ? (
          <div
            ref={stageRef}
            className={`mm-zone__frame${full ? " mm-zone__frame--full" : ""}`}
            style={{ aspectRatio: `${dims.w} / ${dims.h}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <img src={src} alt="template draft" draggable={false} />
            {zones.map((z, i) => (
              <div
                key={z.id}
                data-zone={z.id}
                className={`mm-zone__rect${z.id === selected ? " mm-zone__rect--sel" : ""}`}
                style={{
                  left: `${z.x * 100}%`,
                  top: `${z.y * 100}%`,
                  width: `${z.w * 100}%`,
                  height: `${z.h * 100}%`,
                }}
              >
                {/* not renderMeme — just close enough to judge the fit */}
                <span
                  className="mm-zone__preview"
                  style={{
                    fontSize: `${frameH * PREVIEW_FONT_FRAC}px`,
                    WebkitTextStrokeWidth: `${frameH * PREVIEW_FONT_FRAC * PREVIEW_STROKE_FRAC}px`,
                  }}
                >
                  TEXT {i + 1}
                </span>
                <span className="mm-zone__label" data-zone={z.id}>
                  {i + 1}
                </span>
                {z.id === selected &&
                  HANDLES.map((h) => (
                    <span
                      key={h.handle}
                      className="mm-zone__grip"
                      data-zone={z.id}
                      data-handle={h.handle}
                      style={{
                        left: `${h.hx * 100}%`,
                        top: `${h.hy * 100}%`,
                        cursor: HANDLE_CURSOR[h.handle],
                      }}
                    />
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="ms-empty" style={{ height: "100%" }}>
            <div className="mm-editor__glyph">⊞</div>
            <div className="ms-empty__title">
              {phone
                ? "choose a screenshot, mark the zones, meme forever"
                : "drop a screenshot, mark the zones, meme forever"}
            </div>
          </div>
        )}
      </div>
      {dragging > 0 && <div className="mm-drop">drop it — this becomes the template</div>}
      {keyOpen && <InviteKeyDialog onClose={() => setKeyOpen(false)} />}
    </div>
  )
}
