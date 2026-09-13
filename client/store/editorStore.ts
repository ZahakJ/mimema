import { create } from "zustand"
import { memeDocSchema } from "../../shared/schema.ts"
import type { Layer, MemeDoc, TemplateDto, TextLayer, Zone } from "../../shared/schema.ts"
import { toast } from "../components/Toasts.tsx"

// The working doc survives a refresh (localStorage, see DRAFT_KEY) but undo
// history stays in memory: a meme is a moment, not a project.
// History: snapshot() BEFORE a mutation batch; live updates during a gesture
// don't snapshot (call beginGesture() once at gesture start instead).

const HISTORY_MAX = 60

/** the draft slot promised by shared/schema.ts */
export const DRAFT_KEY = "mimema:v1:editor"
/** pasted stickers are data: URLs — past this we quietly stop saving */
export const DRAFT_MAX_CHARS = 2_000_000
const DRAFT_DEBOUNCE_MS = 400

export type DraftPayload = { templateId: string | null; doc: MemeDoc }
export type SerializeResult =
  | { ok: true; json: string }
  | { ok: false; reason: "empty" | "too-big" }

/** Pure partialize: only {templateId, doc} is ever written — template metadata
 *  is refetched, and past/future/selection are deliberately session-only. */
export function serializeDraft(doc: MemeDoc | null, template: TemplateDto | null): SerializeResult {
  if (!doc) return { ok: false, reason: "empty" }
  const payload: DraftPayload = { templateId: template?.id ?? doc.templateId, doc }
  const json = JSON.stringify(payload)
  if (json.length > DRAFT_MAX_CHARS) return { ok: false, reason: "too-big" }
  return { ok: true, json }
}

/** Pure inverse of serializeDraft: junk in, null out — never throws. */
export function parseDraft(raw: string | null): DraftPayload | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const { templateId, doc } = parsed as { templateId?: unknown; doc?: unknown }
    return {
      templateId: typeof templateId === "string" ? templateId : null,
      doc: memeDocSchema.parse(doc),
    }
  } catch {
    return null
  }
}

// localStorage can be absent (tests, node) or throw (private mode, quota)
function readStore(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}
function writeStore(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, value)
  } catch {
    /* full or blocked — the draft is a nicety, not a contract */
  }
}

type EditorState = {
  template: TemplateDto | null
  doc: MemeDoc | null
  /** seeded from ?title= in a deep link; PublishDialog opens with it */
  title: string
  selectedId: string | null
  past: MemeDoc[]
  future: MemeDoc[]
  /** bumped every time a batch of webfonts lands, so the canvas repaints */
  fontEpoch: number

  bumpFontEpoch: () => void
  loadTemplate: (tpl: TemplateDto) => void
  applyCaptions: (captions: readonly string[]) => void
  setTitle: (title: string) => void
  restoreDraft: (templates: readonly TemplateDto[]) => boolean
  select: (id: string | null) => void
  beginGesture: () => void
  updateLayerLive: (id: string, patch: Partial<Layer>) => void
  setLayerProp: (id: string, patch: Partial<Layer>) => void
  setZoneStyle: (id: string, patch: Partial<TextLayer["style"]>, live?: boolean) => void
  addTextLayer: () => void
  addSticker: (src: string, aspectRatio: number) => void
  duplicateLayer: (id: string) => void
  removeLayer: (id: string) => void
  reorderLayer: (id: string, dir: 1 | -1) => void
  setDeepFry: (on: boolean) => void
  undo: () => void
  redo: () => void
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function textLayerFromZone(zone: Zone): TextLayer {
  return { ...zone, type: "text", id: uid(), text: "" }
}

function clone(doc: MemeDoc): MemeDoc {
  return structuredClone(doc)
}

export const useEditor = create<EditorState>((set, get) => {
  const snapshot = () => {
    const { doc, past } = get()
    if (!doc) return
    set({ past: [...past.slice(-HISTORY_MAX + 1), clone(doc)], future: [] })
  }

  const patchDoc = (fn: (doc: MemeDoc) => MemeDoc) => {
    const { doc } = get()
    if (doc) set({ doc: fn(doc) })
  }

  const patchLayer = (id: string, patch: Partial<Layer>) => {
    patchDoc((doc) => ({
      ...doc,
      layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
    }))
  }

  return {
    template: null,
    doc: null,
    title: "",
    selectedId: null,
    past: [],
    future: [],
    fontEpoch: 0,

    bumpFontEpoch: () => set((s) => ({ fontEpoch: s.fontEpoch + 1 })),

    loadTemplate: (tpl) => {
      const layers = tpl.zones.map(textLayerFromZone)
      set({
        template: tpl,
        // a new template is a new meme — a title from an older link is stale
        title: "",
        doc: {
          templateId: tpl.id,
          width: tpl.width,
          height: tpl.height,
          layers,
          deepFry: false,
        },
        selectedId: layers[0]?.id ?? null,
        past: [],
        future: [],
      })
    },

    /** Fill the text layers from a deep link's ?c= list, in zone order (the
     *  order loadTemplate created them in). Short list → the rest keep what
     *  they have; extras are dropped. Not undoable on purpose: this is part of
     *  opening the doc, like loadTemplate, not an edit you made. */
    applyCaptions: (captions) => {
      let i = 0
      patchDoc((doc) => ({
        ...doc,
        layers: doc.layers.map((l) => {
          if (l.type !== "text") return l
          const text = captions[i++]
          return text === undefined ? l : { ...l, text }
        }),
      }))
    },

    setTitle: (title) => set({ title }),

    /** Rehydrate the saved draft. Callers must have decided the deep link
     *  doesn't win — #/edit/<id> always beats whatever was left lying around. */
    restoreDraft: (templates) => {
      const draft = parseDraft(readStore(DRAFT_KEY))
      if (!draft) return false
      // a template-backed draft is useless without its base image
      const tpl = draft.templateId ? templates.find((t) => t.id === draft.templateId) : null
      if (draft.templateId && !tpl) {
        writeStore(DRAFT_KEY, null)
        return false
      }
      set({
        template: tpl ?? null,
        doc: draft.doc,
        selectedId: null,
        past: [],
        future: [],
      })
      return true
    },

    select: (id) => set({ selectedId: id }),
    beginGesture: snapshot,
    updateLayerLive: patchLayer,

    setLayerProp: (id, patch) => {
      snapshot()
      patchLayer(id, patch)
    },

    setZoneStyle: (id, patch, live = false) => {
      if (!live) snapshot()
      const layer = get().doc?.layers.find((l) => l.id === id)
      if (layer?.type !== "text") return
      patchLayer(id, { style: { ...layer.style, ...patch } } as Partial<Layer>)
    },

    addTextLayer: () => {
      snapshot()
      const layer = textLayerFromZone({
        x: 0.2,
        y: 0.4,
        w: 0.6,
        h: 0.2,
        align: "center",
        valign: "middle",
        angle: 0,
        style: {
          fontFamily: "Anton",
          fontFrac: 0.09,
          fill: "#ffffff",
          stroke: "#000000",
          strokeFrac: 0.08,
          allCaps: true,
        },
        placeholder: "NEW TEXT",
      })
      patchDoc((doc) => ({ ...doc, layers: [...doc.layers, layer] }))
      set({ selectedId: layer.id })
    },

    addSticker: (src, aspectRatio) => {
      snapshot()
      const { doc } = get()
      if (!doc) return
      const docAspect = doc.width / doc.height
      const w = 0.3
      const h = (w / aspectRatio) * docAspect
      const layer = { type: "sticker" as const, id: uid(), x: 0.35, y: 0.35, w, h, angle: 0, src }
      patchDoc((d) => ({ ...d, layers: [...d.layers, layer] }))
      set({ selectedId: layer.id })
    },

    duplicateLayer: (id) => {
      const src = get().doc?.layers.find((l) => l.id === id)
      if (!src) return
      snapshot()
      const copy = {
        ...structuredClone(src),
        id: uid(),
        x: Math.min(src.x + 0.025, Math.max(0, 1 - src.w)),
        y: Math.min(src.y + 0.025, Math.max(0, 1 - src.h)),
      } as Layer
      patchDoc((doc) => ({ ...doc, layers: [...doc.layers, copy] }))
      set({ selectedId: copy.id })
    },

    removeLayer: (id) => {
      snapshot()
      patchDoc((doc) => ({ ...doc, layers: doc.layers.filter((l) => l.id !== id) }))
      if (get().selectedId === id) set({ selectedId: null })
    },

    reorderLayer: (id, dir) => {
      snapshot()
      patchDoc((doc) => {
        const i = doc.layers.findIndex((l) => l.id === id)
        const j = i + dir
        if (i === -1 || j < 0 || j >= doc.layers.length) return doc
        const layers = [...doc.layers]
        const a = layers[i]!
        layers[i] = layers[j]!
        layers[j] = a
        return { ...doc, layers }
      })
    },

    setDeepFry: (on) => {
      snapshot()
      patchDoc((doc) => ({ ...doc, deepFry: on }))
    },

    undo: () => {
      const { past, future, doc } = get()
      const prev = past[past.length - 1]
      if (!prev || !doc) return
      set({ doc: prev, past: past.slice(0, -1), future: [clone(doc), ...future].slice(0, HISTORY_MAX) })
    },

    redo: () => {
      const { past, future, doc } = get()
      const next = future[0]
      if (!next || !doc) return
      set({ doc: next, future: future.slice(1), past: [...past, clone(doc)].slice(-HISTORY_MAX) })
    },
  }
})

// ————— draft persistence —————
// A plain debounced subscribe rather than zustand/persist: only two fields are
// worth keeping, restore has to wait for the template list, and an oversized
// doc must be skipped rather than thrown at the quota.

let draftTimer: ReturnType<typeof setTimeout> | null = null
let warnedTooBig = false

function saveDraftNow(): void {
  const { doc, template } = useEditor.getState()
  const result = serializeDraft(doc, template)
  if (result.ok) {
    writeStore(DRAFT_KEY, result.json)
    return
  }
  if (result.reason === "too-big" && !warnedTooBig) {
    warnedTooBig = true
    toast("This meme is too heavy to autosave — don't refresh before you ship it", "warn")
  }
}

useEditor.subscribe((state, prev) => {
  if (state.doc === prev.doc && state.template === prev.template) return
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(saveDraftNow, DRAFT_DEBOUNCE_MS)
})
