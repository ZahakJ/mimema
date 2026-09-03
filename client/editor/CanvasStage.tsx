import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEditor } from "../store/editorStore.ts"
import { renderMeme, type Assets } from "./renderMeme.ts"
import { loadImage } from "./exportPng.ts"
import { deepFry } from "./deepFry.ts"
import {
  HANDLES,
  applyDrag,
  applyResize,
  applyRotate,
  hitTest,
  type FracRect,
  type Handle,
} from "./interactions.ts"

type Gesture =
  | { type: "drag"; layerId: string; lastX: number; lastY: number }
  | { type: "resize"; layerId: string; handle: Handle; lastX: number; lastY: number }
  | { type: "rotate"; layerId: string }

/** the fryer is expensive (two JPEG round trips); cook a small copy */
const FRY_PREVIEW_W = 700
const FRY_DEBOUNCE_MS = 250

export function CanvasStage() {
  const doc = useEditor((s) => s.doc)
  const template = useEditor((s) => s.template)
  const selectedId = useEditor((s) => s.selectedId)
  const fontEpoch = useEditor((s) => s.fontEpoch)
  const { select, beginGesture, updateLayerLive, removeLayer } = useEditor.getState()

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  // every repaint invalidates any fry still in flight
  const fryRunRef = useRef(0)
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 })
  const [assets, setAssets] = useState<Assets>({ base: null, stickers: new Map() })

  // track container size
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWrapSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // load base + sticker images whenever their sources change
  const stickerKey = useMemo(
    () =>
      doc?.layers
        .filter((l) => l.type === "sticker")
        .map((l) => `${l.id}:${l.type === "sticker" ? l.src.length : 0}`)
        .join("|") ?? "",
    [doc],
  )
  useEffect(() => {
    let alive = true
    const run = async () => {
      const next: Assets = { base: null, stickers: new Map() }
      if (template) {
        try {
          next.base = await loadImage(template.imageUrl)
        } catch {
          next.base = null
        }
      }
      await Promise.all(
        (doc?.layers ?? [])
          .filter((l): l is Extract<typeof l, { type: "sticker" }> => l.type === "sticker")
          .map(async (l) => {
            try {
              next.stickers.set(l.id, await loadImage(l.src))
            } catch {
              /* sticker failed to decode */
            }
          }),
      )
      if (alive) setAssets(next)
    }
    void run()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, stickerKey])

  // display geometry: fit doc inside wrapper, preserve aspect
  const disp = useMemo(() => {
    if (!doc || wrapSize.w === 0 || wrapSize.h === 0) return { w: 0, h: 0, scale: 0 }
    const pad = 24
    const scale = Math.min(
      (wrapSize.w - pad) / doc.width,
      (wrapSize.h - pad) / doc.height,
      1.5,
    )
    return { w: doc.width * scale, h: doc.height * scale, scale }
  }, [doc, wrapSize])

  // draw. Selection chrome is DOM (.mm-sel), never canvas — which is exactly
  // why the fryer can eat the whole canvas and leave the handles crisp.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !doc || disp.scale === 0) return
    const run = ++fryRunRef.current
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(disp.w * dpr)
    canvas.height = Math.round(disp.h * dpr)
    const ctx = canvas.getContext("2d")!
    ctx.setTransform(disp.scale * dpr, 0, 0, disp.scale * dpr, 0, 0)
    ctx.imageSmoothingQuality = "high"
    renderMeme(ctx, doc, assets)
    if (!doc.deepFry) return

    // fry a downscaled copy a beat after the edits stop, then blit it over
    // the raw preview — same fryer the export uses
    const timer = window.setTimeout(() => {
      const fw = Math.min(FRY_PREVIEW_W, doc.width)
      const scale = fw / doc.width
      const off = document.createElement("canvas")
      off.width = Math.round(fw)
      off.height = Math.round(doc.height * scale)
      const octx = off.getContext("2d")!
      octx.setTransform(scale, 0, 0, scale, 0, 0)
      octx.imageSmoothingQuality = "high"
      renderMeme(octx, doc, assets)
      void deepFry(off).then(
        () => {
          if (fryRunRef.current !== run || canvasRef.current !== canvas) return
          const c = canvas.getContext("2d")!
          c.save()
          c.setTransform(1, 0, 0, 1, 0, 0)
          c.drawImage(off, 0, 0, canvas.width, canvas.height)
          c.restore()
        },
        () => {
          /* fry failed — the raw preview is already on screen */
        },
      )
    }, FRY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [doc, assets, disp, fontEpoch])

  const toFrac = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const rect = canvasRef.current!.getBoundingClientRect()
      return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
    },
    [],
  )

  if (!doc) return null
  const aspect = doc.width / doc.height
  const selected = doc.layers.find((l) => l.id === selectedId)

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    const p = toFrac(e)
    const handle = target.dataset.handle as Handle | "rotate" | undefined

    if (handle && selectedId) {
      beginGesture()
      gestureRef.current =
        handle === "rotate"
          ? { type: "rotate", layerId: selectedId }
          : { type: "resize", layerId: selectedId, handle, lastX: p.x, lastY: p.y }
    } else {
      // topmost layer wins
      const hit = [...doc.layers].reverse().find((l) => hitTest(l as FracRect, p.x, p.y, aspect))
      if (hit) {
        select(hit.id)
        beginGesture()
        gestureRef.current = { type: "drag", layerId: hit.id, lastX: p.x, lastY: p.y }
      } else {
        select(null)
      }
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g) return
    const p = toFrac(e)
    const layer = doc.layers.find((l) => l.id === g.layerId)
    if (!layer) return
    const rect = layer as FracRect

    if (g.type === "rotate") {
      updateLayerLive(g.layerId, applyRotate(rect, p.x, p.y, aspect))
    } else if (g.type === "drag") {
      updateLayerLive(g.layerId, applyDrag(rect, p.x - g.lastX, p.y - g.lastY))
      g.lastX = p.x
      g.lastY = p.y
    } else {
      updateLayerLive(g.layerId, applyResize(rect, g.handle, p.x - g.lastX, p.y - g.lastY, aspect))
      g.lastX = p.x
      g.lastY = p.y
    }
  }

  const onPointerUp = () => {
    gestureRef.current = null
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!selectedId) return
    const layer = doc.layers.find((l) => l.id === selectedId)
    if (!layer) return
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      removeLayer(selectedId)
      return
    }
    const step = e.shiftKey ? 0.03 : 0.006
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const d = nudge[e.key]
    if (d) {
      e.preventDefault()
      beginGesture()
      updateLayerLive(selectedId, applyDrag(layer as FracRect, d[0], d[1]))
    }
  }

  return (
    <div className="mm-stage" ref={wrapRef}>
      <div
        className="mm-stage__frame"
        style={{ width: disp.w, height: disp.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        // a touch that turns into a system gesture (or a call arriving) fires
        // cancel, never up — without this the layer stays glued to the finger
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          const l = doc.layers.find((x) => x.id === useEditor.getState().selectedId)
          if (l?.type === "text") window.dispatchEvent(new Event("mimema:focus-text"))
        }}
        tabIndex={0}
        role="application"
        aria-label="meme canvas"
      >
        <canvas ref={canvasRef} className="mm-stage__canvas" style={{ width: disp.w, height: disp.h }} />
        {selected && (
          <div
            className="mm-sel"
            style={{
              left: selected.x * disp.w,
              top: selected.y * disp.h,
              width: selected.w * disp.w,
              height: selected.h * disp.h,
              transform: `rotate(${selected.angle}deg)`,
            }}
          >
            {HANDLES.map((h) => (
              <div
                key={h.handle}
                className="mm-sel__handle"
                data-handle={h.handle}
                style={{
                  left: `${h.hx * 100}%`,
                  top: `${h.hy * 100}%`,
                  cursor: cursorFor(h.handle, selected.angle),
                }}
              />
            ))}
            <div className="mm-sel__stem" />
            <div className="mm-sel__rotate" data-handle="rotate" title="drag to rotate">
              ⟳
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"] as const
function cursorFor(handle: Handle, angle: number): string {
  const base: Record<Handle, number> = { n: 0, ne: 1, e: 2, se: 3, s: 0, sw: 1, w: 2, nw: 3 }
  const shift = Math.round(((angle % 180) + 180) / 45) % 4
  return CURSORS[(base[handle] + shift) % 4]!
}
