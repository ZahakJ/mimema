import { useEffect, useMemo, useRef, useState } from "react"
import type { TemplateDto, ZoneStyle } from "../../shared/schema.ts"
import { api } from "../api/client.ts"
import { useEditor } from "../store/editorStore.ts"
import { CanvasStage } from "./CanvasStage.tsx"
import { Inspector } from "./Inspector.tsx"
import { TemplatePicker } from "./TemplatePicker.tsx"
import { loadImage } from "./exportPng.ts"
import { fontLoadSpec } from "./renderMeme.ts"
import { toast } from "../components/Toasts.tsx"

export function EditorView({ templateId }: { templateId?: string }) {
  const doc = useEditor((s) => s.doc)
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null)
  const restoredRef = useRef(false)

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

  return (
    <div className="mm-editor">
      <TemplatePicker templates={templates ?? []} loading={templates === null} />
      {doc ? (
        <>
          <CanvasStage />
          <Inspector />
        </>
      ) : (
        <div className="ms-empty mm-editor__empty">
          <div className="mm-editor__glyph">◱</div>
          <div className="ms-empty__title">
            {templates === null ? "loading templates…" : "pick a template to start forging"}
          </div>
          <div>or hit 🎲 for fate to decide</div>
        </div>
      )}
    </div>
  )
}
