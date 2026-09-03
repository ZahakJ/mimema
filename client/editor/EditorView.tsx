import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TemplateDto, ZoneStyle } from "../../shared/schema.ts"
import { api } from "../api/client.ts"
import { useEditor } from "../store/editorStore.ts"
import { usePhone } from "../usePhone.ts"
import { CanvasStage } from "./CanvasStage.tsx"
import { Inspector } from "./Inspector.tsx"
import { TemplatePicker } from "./TemplatePicker.tsx"
import { PublishDialog } from "./PublishDialog.tsx"
import { Sheet } from "../components/Sheet.tsx"
import { loadImage } from "./exportPng.ts"
import { fontLoadSpec } from "./renderMeme.ts"
import { toast } from "../components/Toasts.tsx"

/** Which rail the phone has pulled up over the canvas, if any. */
type PhoneSheet = "templates" | "edit"

export function EditorView({ templateId }: { templateId?: string }) {
  const doc = useEditor((s) => s.doc)
  const selectedId = useEditor((s) => s.selectedId)
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null)
  const restoredRef = useRef(false)
  const phone = usePhone()
  const [sheet, setSheet] = useState<PhoneSheet | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  // set when the canvas asks for the keyboard (double-tap a text zone) so the
  // inspector — which only mounts once the sheet opens — knows to take focus
  const [focusText, setFocusText] = useState(false)

  // every family the doc actually asks for, plus the default — switching a
  // layer to a font nobody used yet has to load it before the next paint
  const fontKey = useMemo(() => {
    const families = new Set<ZoneStyle["fontFamily"]>(["Anton"])
    for (const l of doc?.layers ?? []) if (l.type === "text") families.add(l.style.fontFamily)
    return [...families].sort().join("|")
  }, [doc])

  // fonts must be resident before the canvas paints or the fallback font
  // bakes into the preview; each batch bumps fontEpoch to force a repaint
  useEffect(() => {
    const specs = fontKey.split("|").map((f) => fontLoadSpec(f as ZoneStyle["fontFamily"]))
    const { bumpFontEpoch } = useEditor.getState()
    void Promise.all(specs.map((s) => document.fonts.load(s))).then(bumpFontEpoch, bumpFontEpoch)
  }, [fontKey])

  useEffect(() => {
    api.listTemplates().then(setTemplates, () => {
      toast("Could not load templates", "danger")
      setTemplates([])
    })
  }, [])

  // deep link #/edit/<id> (also how the zone editor jumps in)
  useEffect(() => {
    if (!templates || !templateId) return
    if (useEditor.getState().doc?.templateId === templateId) return
    const tpl = templates.find((t) => t.id === templateId)
    if (tpl) useEditor.getState().loadTemplate(tpl)
  }, [templates, templateId])

  // …and only if no deep link claimed the editor: pick the draft back up
  useEffect(() => {
    if (!templates || restoredRef.current) return
    restoredRef.current = true
    if (templateId || useEditor.getState().doc) return
    if (useEditor.getState().restoreDraft(templates)) toast("Picked up where you left off")
  }, [templates, templateId])

  // a sheet left open across a rotate-to-landscape would strand the rails
  useEffect(() => {
    if (!phone) setSheet(null)
  }, [phone])

  // double-tap on a text zone wants the keyboard; on a phone that means
  // pulling the inspector up first. On a desktop the inspector is already
  // mounted and listens for the event itself.
  useEffect(() => {
    if (!phone) return
    const open = () => {
      setSheet("edit")
      setFocusText(true)
    }
    window.addEventListener("mimema:focus-text", open)
    return () => window.removeEventListener("mimema:focus-text", open)
  }, [phone])

  const closeSheet = useCallback(() => {
    setSheet(null)
    setFocusText(false)
  }, [])

  // picking a template on a phone hands you straight to the text boxes —
  // that is the whole reason you picked it. The canvas stays visible above
  // the (deliberately short) edit sheet.
  const afterPick = useCallback(() => {
    setFocusText(false)
    setSheet("edit")
  }, [])

  // global shortcuts + clipboard stickers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === "TEXTAREA" || el.tagName === "INPUT"
      if (e.key === "Escape" && typing) {
        el.blur()
        return
      }
      if (typing || el.tagName === "SELECT") return
      if (e.key === "Escape") useEditor.getState().select(null)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault()
        const id = useEditor.getState().selectedId
        if (id) useEditor.getState().duplicateLayer(id)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) useEditor.getState().redo()
        else useEditor.getState().undo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault()
        useEditor.getState().redo()
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (!useEditor.getState().doc) return
      const el = e.target as HTMLElement
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return
      const file = [...(e.clipboardData?.items ?? [])]
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile()
      if (!file) return
      e.preventDefault()
      const reader = new FileReader()
      reader.onload = async () => {
        const src = String(reader.result)
        const img = await loadImage(src)
        useEditor.getState().addSticker(src, img.naturalWidth / Math.max(1, img.naturalHeight))
        toast("Sticker pasted")
      }
      reader.readAsDataURL(file)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("paste", onPaste)
    }
  }, [])

  const empty = (
    <div className="ms-empty mm-editor__empty">
      <div className="mm-editor__glyph">◱</div>
      <div className="ms-empty__title">
        {templates === null ? "loading templates…" : "pick a template to start forging"}
      </div>
      {phone ? (
        <button
          className="ms-btn ms-btn--primary"
          disabled={templates === null}
          onClick={() => setSheet("templates")}
        >
          ◱ browse templates
        </button>
      ) : (
        <div>or hit 🎲 for fate to decide</div>
      )}
    </div>
  )

  // ————— phone: one canvas, one tray, two sheets —————
  if (phone) {
    const selected = doc?.layers.find((l) => l.id === selectedId)
    return (
      <div className={`mm-editor mm-editor--phone${sheet === "edit" ? " mm-editor--lifted" : ""}`}>
        {doc ? <CanvasStage /> : empty}
        <div className="mm-tray">
          <button className="ms-btn mm-tray__btn" onClick={() => setSheet("templates")}>
            <span className="mm-tray__glyph" aria-hidden="true">
              ◱
            </span>
            templates
          </button>
          <button
            className={`ms-btn mm-tray__btn${selected ? " ms-btn--active" : ""}`}
            disabled={!doc}
            onClick={() => setSheet("edit")}
          >
            <span className="mm-tray__glyph" aria-hidden="true">
              ✎
            </span>
            {selected?.type === "text" ? "text" : "edit"}
          </button>
          <button
            className="ms-btn mm-tray__btn mm-tray__ship"
            disabled={!doc}
            onClick={() => setPublishOpen(true)}
          >
            <span className="mm-tray__glyph" aria-hidden="true">
              ⤴
            </span>
            ship it
          </button>
        </div>

        {sheet === "templates" && (
          <Sheet title="templates" tall onClose={closeSheet}>
            <TemplatePicker
              templates={templates ?? []}
              loading={templates === null}
              onPicked={afterPick}
            />
          </Sheet>
        )}
        {sheet === "edit" && doc && (
          <Sheet title={selected ? "layer" : "this meme"} modal={false} onClose={closeSheet}>
            <Inspector autoFocusText={focusText} />
          </Sheet>
        )}
        {publishOpen && <PublishDialog onClose={() => setPublishOpen(false)} />}
      </div>
    )
  }

  return (
    <div className="mm-editor">
      <TemplatePicker templates={templates ?? []} loading={templates === null} />
      {doc ? (
        <>
          <CanvasStage />
          <Inspector />
        </>
      ) : (
        empty
      )}
    </div>
  )
}
