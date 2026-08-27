import { useEffect, useRef, useState } from "react"
import { useEditor } from "../store/editorStore.ts"
import { PublishDialog } from "./PublishDialog.tsx"
import { loadImage } from "./exportPng.ts"
import { DEFAULT_TEXT_SHADOW, MEME_FONTS } from "../../shared/schema.ts"
import type { Layer, TextLayer } from "../../shared/schema.ts"

export function Inspector() {
  const doc = useEditor((s) => s.doc)
  const selectedId = useEditor((s) => s.selectedId)
  const past = useEditor((s) => s.past)
  const future = useEditor((s) => s.future)
  const {
    select,
    setLayerProp,
    setZoneStyle,
    updateLayerLive,
    beginGesture,
    addTextLayer,
    addSticker,
    removeLayer,
    reorderLayer,
    setDeepFry,
    undo,
    redo,
  } = useEditor.getState()
  const [publishOpen, setPublishOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  // typing coalesces into word-ish undo steps: the first keystroke after a
  // focus or a ~600ms pause snapshots, the rest ride live
  const idleRef = useRef<number | null>(null)
  const freshRef = useRef(true)

  // dblclick on a text zone → focus the text box
  useEffect(() => {
    const onFocusText = () => textRef.current?.focus()
    window.addEventListener("mimema:focus-text", onFocusText)
    return () => window.removeEventListener("mimema:focus-text", onFocusText)
  }, [])

  useEffect(() => {
    freshRef.current = true
  }, [selectedId])

  useEffect(() => () => void (idleRef.current && clearTimeout(idleRef.current)), [])

  const typeText = (id: string, value: string) => {
    if (freshRef.current) {
      beginGesture()
      freshRef.current = false
    }
    updateLayerLive(id, { text: value })
    if (idleRef.current) clearTimeout(idleRef.current)
    idleRef.current = window.setTimeout(() => {
      freshRef.current = true
    }, 600)
  }

  if (!doc) return null
  const layer = doc.layers.find((l) => l.id === selectedId)
  const text = layer?.type === "text" ? (layer as TextLayer) : null
  const shadow = text?.style.shadow ?? null

  const pickSticker = async (file: File) => {
    const src = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error("read failed"))
      r.readAsDataURL(file)
    })
    const img = await loadImage(src)
    addSticker(src, img.naturalWidth / Math.max(1, img.naturalHeight))
  }

  return (
    <aside className="mm-inspector">
      <div className="mm-inspector__scroll">
        <section className="mm-inspector__group">
          <div className="mm-inspector__title">Layers</div>
          <div className="mm-inspector__row">
            <button className="ms-btn" onClick={addTextLayer}>
              + text
            </button>
            <button className="ms-btn" onClick={() => fileRef.current?.click()}>
              + sticker
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void pickSticker(f)
                e.target.value = ""
              }}
            />
          </div>
          <div className="mm-inspector__hint">or paste an image from the clipboard</div>
        </section>

        {text && (
          <section className="mm-inspector__group">
            <div className="mm-inspector__title">Text</div>
            <textarea
              ref={textRef}
              className="mm-text-input"
              rows={3}
              placeholder={text.placeholder ?? "say something"}
              value={text.text}
              onFocus={() => (freshRef.current = true)}
              onChange={(e) => typeText(text.id, e.target.value)}
            />
            <label className="mm-field">
              <span>font</span>
              <select
                value={text.style.fontFamily}
                onChange={(e) =>
                  setZoneStyle(text.id, { fontFamily: e.target.value as TextLayer["style"]["fontFamily"] })
                }
              >
                {MEME_FONTS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <div className="ms-slider">
              <span className="ms-slider__label">size</span>
              <input
                type="range"
                min={0.03}
                max={0.3}
                step={0.005}
                value={text.style.fontFrac}
                onPointerDown={beginGesture}
                onChange={(e) => setZoneStyle(text.id, { fontFrac: Number(e.target.value) }, true)}
              />
              <span className="ms-slider__value">{Math.round(text.style.fontFrac * 200)}</span>
            </div>
            <div className="ms-slider">
              <span className="ms-slider__label">outline</span>
              <input
                type="range"
                min={0}
                max={0.2}
                step={0.01}
                value={text.style.strokeFrac}
                onPointerDown={beginGesture}
                onChange={(e) => setZoneStyle(text.id, { strokeFrac: Number(e.target.value) }, true)}
              />
              <span className="ms-slider__value">{Math.round(text.style.strokeFrac * 100)}</span>
            </div>
            <div className="mm-inspector__row">
              <label className="mm-swatch">
                <input
                  type="color"
                  value={text.style.fill}
                  onPointerDown={beginGesture}
                  onChange={(e) => setZoneStyle(text.id, { fill: e.target.value }, true)}
                />
                <span>fill</span>
              </label>
              <label className="mm-swatch">
                <input
                  type="color"
                  value={text.style.stroke}
                  onPointerDown={beginGesture}
                  onChange={(e) => setZoneStyle(text.id, { stroke: e.target.value }, true)}
                />
                <span>outline</span>
              </label>
              <button
                className={`ms-btn${text.style.allCaps ? " ms-btn--active" : ""}`}
                title="all caps"
                onClick={() => setZoneStyle(text.id, { allCaps: !text.style.allCaps })}
              >
                AA
              </button>
            </div>
            <div className="mm-inspector__row">
              <div className="ms-seg" role="group" aria-label="align">
                {(["left", "center", "right"] as const).map((a) => (
                  <button
                    key={a}
                    title={`align ${a}`}
                    className={`ms-seg__opt${text.align === a ? " ms-seg__opt--active" : ""}`}
                    onClick={() => setLayerProp(text.id, { align: a })}
                  >
                    {a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}
                  </button>
                ))}
              </div>
              <div className="ms-seg" role="group" aria-label="vertical align">
                {(["top", "middle", "bottom"] as const).map((v) => (
                  <button
                    key={v}
                    title={`anchor to ${v}`}
                    className={`ms-seg__opt${text.valign === v ? " ms-seg__opt--active" : ""}`}
                    onClick={() => setLayerProp(text.id, { valign: v })}
                  >
                    {v === "top" ? "⤒" : v === "middle" ? "↕" : "⤓"}
                  </button>
                ))}
              </div>
            </div>

            <div className="mm-inspector__row">
              <button
                className={`ms-btn${shadow ? " ms-btn--active" : ""}`}
                title="drop shadow"
                onClick={() =>
                  setZoneStyle(text.id, { shadow: shadow ? undefined : DEFAULT_TEXT_SHADOW })
                }
              >
                shadow
              </button>
              {shadow && (
                <label className="mm-swatch">
                  <input
                    type="color"
                    value={shadow.color}
                    onPointerDown={beginGesture}
                    onChange={(e) =>
                      setZoneStyle(text.id, { shadow: { ...shadow, color: e.target.value } }, true)
                    }
                  />
                  <span>color</span>
                </label>
              )}
            </div>
            {shadow && (
              <>
                <div className="ms-slider">
                  <span className="ms-slider__label">blur</span>
                  <input
                    type="range"
                    min={0}
                    max={0.05}
                    step={0.002}
                    value={shadow.blur}
                    onPointerDown={beginGesture}
                    onChange={(e) =>
                      setZoneStyle(text.id, { shadow: { ...shadow, blur: Number(e.target.value) } }, true)
                    }
                  />
                  <span className="ms-slider__value">{Math.round(shadow.blur * 1000)}</span>
                </div>
                <div className="ms-slider">
                  <span className="ms-slider__label">offset</span>
                  <input
                    type="range"
                    min={0}
                    max={0.04}
                    step={0.002}
                    value={shadow.dy}
                    onPointerDown={beginGesture}
                    onChange={(e) => {
                      // one slider, cast down-and-right — the schema keeps dx/dy
                      // separate for anything fancier
                      const d = Number(e.target.value)
                      setZoneStyle(text.id, { shadow: { ...shadow, dx: d * 0.75, dy: d } }, true)
                    }}
                  />
                  <span className="ms-slider__value">{Math.round(shadow.dy * 1000)}</span>
                </div>
              </>
            )}
          </section>
        )}

        {doc.layers.length > 0 && (
          <section className="mm-inspector__group">
            <div className="mm-inspector__title">Stack</div>
            <div className="mm-layers">
              {[...doc.layers].reverse().map((l, i) => {
                const idx = doc.layers.length - 1 - i
                return (
                  <div
                    key={l.id}
                    className={`mm-layer${l.id === selectedId ? " mm-layer--on" : ""}`}
                    onClick={() => select(l.id)}
                  >
                    {l.type === "text" ? (
                      <span className="mm-layer__glyph">T</span>
                    ) : (
                      <img className="mm-layer__thumb" src={l.src} alt="" />
                    )}
                    <span className="mm-layer__name">{layerLabel(l)}</span>
                    <button
                      className="mm-layer__move"
                      title="bring forward"
                      disabled={idx === doc.layers.length - 1}
                      onClick={(e) => {
                        e.stopPropagation()
                        reorderLayer(l.id, 1)
                      }}
                    >
                      ▲
                    </button>
                    <button
                      className="mm-layer__move"
                      title="send back"
                      disabled={idx === 0}
                      onClick={(e) => {
                        e.stopPropagation()
                        reorderLayer(l.id, -1)
                      }}
                    >
                      ▼
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {layer && (
          <section className="mm-inspector__group">
            <div className="mm-inspector__title">Selected layer</div>
            <div className="mm-inspector__row">
              {layer.angle !== 0 && (
                <button className="ms-btn" onClick={() => setLayerProp(layer.id, { angle: 0 })}>
                  straighten
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="ms-btn ms-btn--danger" onClick={() => removeLayer(layer.id)}>
                delete
              </button>
            </div>
            <div className="mm-inspector__hint">
              drag to move · corners resize · ⟳ rotates · arrows nudge · Del removes ·{" "}
              <span className="mono">Ctrl/⌘+D</span> duplicates · <span className="mono">Esc</span>{" "}
              deselects
            </div>
          </section>
        )}

        <section className="mm-inspector__group">
          <div className="mm-inspector__title">Cookery</div>
          <button
            className={`ms-toggle${doc.deepFry ? " ms-toggle--on" : ""}`}
            onClick={() => setDeepFry(!doc.deepFry)}
          >
            <span className="ms-toggle__track">
              <span className="ms-toggle__thumb" />
            </span>
            deep fry 🍟
          </button>
          {doc.deepFry && (
            <div className="mm-inspector__hint">the preview cooks a moment after you stop editing</div>
          )}
        </section>

        <section className="mm-inspector__group">
          <div className="mm-inspector__row">
            <button className="ms-btn" disabled={past.length === 0} onClick={undo} title="Ctrl+Z">
              ↩ undo
            </button>
            <button className="ms-btn" disabled={future.length === 0} onClick={redo} title="Ctrl+Y">
              redo ↪
            </button>
          </div>
        </section>
      </div>

      <div className="mm-inspector__footer">
        <button className="mm-ship" onClick={() => setPublishOpen(true)}>
          Ship it ⤴
        </button>
      </div>
      {publishOpen && <PublishDialog onClose={() => setPublishOpen(false)} />}
    </aside>
  )
}

const LABEL_MAX = 16

function layerLabel(layer: Layer): string {
  if (layer.type === "sticker") return "sticker"
  const raw = layer.text.replaceAll(/\s+/g, " ").trim() || layer.placeholder || "empty"
  return raw.length > LABEL_MAX ? `${raw.slice(0, LABEL_MAX)}…` : raw
}
