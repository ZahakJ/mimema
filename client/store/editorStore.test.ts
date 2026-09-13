import { describe, expect, it, beforeEach } from "vitest"
import { DRAFT_KEY, parseDraft, serializeDraft, useEditor } from "./editorStore.ts"
import { DEFAULT_ZONE_STYLE, type MemeDoc, type TemplateDto } from "../../shared/schema.ts"

// node has no localStorage; the store only ever touches globalThis.localStorage
const store = new Map<string, string>()
const memoryStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
} satisfies Storage
Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true })

const TPL: TemplateDto = {
  id: "smoke",
  name: "Smoke",
  source: "custom",
  ext: "png",
  width: 800,
  height: 600,
  zones: [
    { x: 0.1, y: 0.1, w: 0.5, h: 0.2, align: "center", valign: "middle", angle: 0, style: DEFAULT_ZONE_STYLE },
  ],
  imageUrl: "/t/smoke.png",
  sourceUrl: null,
  createdAt: 0,
}

describe("editor store", () => {
  beforeEach(() => useEditor.getState().loadTemplate(TPL))

  it("duplicates the selected layer offset, selected, and undoable", () => {
    const { duplicateLayer, undo } = useEditor.getState()
    const src = useEditor.getState().doc!.layers[0]!
    duplicateLayer(src.id)

    const { doc, selectedId } = useEditor.getState()
    expect(doc!.layers).toHaveLength(2)
    const copy = doc!.layers[1]!
    expect(copy.id).not.toBe(src.id)
    expect(copy.x).toBeCloseTo(src.x + 0.025)
    expect(copy.y).toBeCloseTo(src.y + 0.025)
    expect(selectedId).toBe(copy.id)

    undo()
    expect(useEditor.getState().doc!.layers).toHaveLength(1)
  })

  it("keeps the duplicate inside the document", () => {
    const { setLayerProp, duplicateLayer } = useEditor.getState()
    const id = useEditor.getState().doc!.layers[0]!.id
    setLayerProp(id, { x: 0.99, y: 0.99 })
    duplicateLayer(id)
    const copy = useEditor.getState().doc!.layers[1]!
    expect(copy.x + copy.w).toBeLessThanOrEqual(1)
    expect(copy.y + copy.h).toBeLessThanOrEqual(1)
  })

  it("live style edits skip history, plain ones snapshot", () => {
    const { setZoneStyle } = useEditor.getState()
    const id = useEditor.getState().doc!.layers[0]!.id
    setZoneStyle(id, { fill: "#ff0000" }, true)
    expect(useEditor.getState().past).toHaveLength(0)
    setZoneStyle(id, { fill: "#00ff00" })
    expect(useEditor.getState().past).toHaveLength(1)
  })

  it("reorders a layer one step and undoes it", () => {
    const { addTextLayer, reorderLayer, undo } = useEditor.getState()
    const bottom = useEditor.getState().doc!.layers[0]!.id
    addTextLayer()
    const top = useEditor.getState().doc!.layers[1]!.id

    // forward from the top is a no-op, back swaps
    reorderLayer(top, 1)
    expect(useEditor.getState().doc!.layers.map((l) => l.id)).toEqual([bottom, top])
    reorderLayer(top, -1)
    expect(useEditor.getState().doc!.layers.map((l) => l.id)).toEqual([top, bottom])

    undo()
    expect(useEditor.getState().doc!.layers.map((l) => l.id)).toEqual([bottom, top])
  })

  it("reorder leaves selection alone", () => {
    const { addTextLayer, reorderLayer } = useEditor.getState()
    addTextLayer()
    const selected = useEditor.getState().selectedId
    reorderLayer(selected!, -1)
    expect(useEditor.getState().selectedId).toBe(selected)
  })
})

// the deep link #/edit/<id>?c=…&c=… lands here
describe("applyCaptions", () => {
  const TPL3: TemplateDto = {
    ...TPL,
    id: "three",
    zones: [0, 1, 2].map((i) => ({
      x: 0.1,
      y: 0.1 + i * 0.25,
      w: 0.5,
      h: 0.2,
      align: "center" as const,
      valign: "middle" as const,
      angle: 0,
      style: DEFAULT_ZONE_STYLE,
      placeholder: `zone ${i}`,
    })),
  }
  const texts = () => useEditor.getState().doc!.layers.map((l) => (l.type === "text" ? l.text : "·"))

  beforeEach(() => useEditor.getState().loadTemplate(TPL3))

  it("fills the text layers in zone order", () => {
    useEditor.getState().applyCaptions(["one", "two", "three"])
    expect(texts()).toEqual(["one", "two", "three"])
  })

  it("leaves zones past the end of the list alone, and drops extras", () => {
    useEditor.getState().applyCaptions(["only"])
    expect(texts()).toEqual(["only", "", ""])
    useEditor.getState().applyCaptions(["a", "b", "c", "d", "e"])
    expect(texts()).toEqual(["a", "b", "c"])
  })

  it("an empty caption is an empty zone, not a skipped one", () => {
    useEditor.getState().applyCaptions(["", "second"])
    expect(texts()).toEqual(["", "second", ""])
  })

  it("beats whatever the doc already had — a link is an explicit intent", () => {
    useEditor.getState().applyCaptions(["stale", "stale", "stale"])
    useEditor.getState().applyCaptions(["fresh"])
    expect(texts()).toEqual(["fresh", "stale", "stale"])
  })

  it("counts text layers only — a sticker never eats a caption", () => {
    useEditor.getState().addSticker("data:image/png;base64,AA==", 1)
    useEditor.getState().applyCaptions(["one", "two", "three", "four"])
    expect(texts()).toEqual(["one", "two", "three", "·"])
  })

  it("is part of opening the doc, so it leaves no undo step", () => {
    useEditor.getState().applyCaptions(["one"])
    expect(useEditor.getState().past).toHaveLength(0)
  })

  it("carries ?title= for the ship dialog, and a new template clears it", () => {
    useEditor.getState().setTitle("Deep-linked")
    expect(useEditor.getState().title).toBe("Deep-linked")
    useEditor.getState().loadTemplate(TPL)
    expect(useEditor.getState().title).toBe("")
  })
})

describe("draft partialize", () => {
  beforeEach(() => useEditor.getState().loadTemplate(TPL))

  it("keeps only templateId + doc, never history or selection", () => {
    const { doc, template } = useEditor.getState()
    const result = serializeDraft(doc, template)
    expect(result.ok).toBe(true)
    const parsed: unknown = JSON.parse((result as { json: string }).json)
    expect(Object.keys(parsed as object).sort()).toEqual(["doc", "templateId"])
    expect((parsed as { templateId: string }).templateId).toBe("smoke")
  })

  it("skips an oversized doc rather than saving half of it", () => {
    const doc = useEditor.getState().doc!
    const fat: MemeDoc = {
      ...doc,
      layers: [
        ...doc.layers,
        {
          type: "sticker",
          id: "fat",
          x: 0,
          y: 0,
          w: 0.5,
          h: 0.5,
          angle: 0,
          src: `data:image/png;base64,${"A".repeat(2_100_000)}`,
        },
      ],
    }
    expect(serializeDraft(fat, useEditor.getState().template)).toEqual({
      ok: false,
      reason: "too-big",
    })
    expect(serializeDraft(null, null)).toEqual({ ok: false, reason: "empty" })
  })

  it("round-trips through parseDraft and shrugs off junk", () => {
    const { doc, template } = useEditor.getState()
    const json = (serializeDraft(doc, template) as { json: string }).json
    expect(parseDraft(json)?.doc.layers).toHaveLength(doc!.layers.length)
    expect(parseDraft("not json")).toBeNull()
    expect(parseDraft('{"templateId":"smoke"}')).toBeNull()
    expect(parseDraft(null)).toBeNull()
  })

  it("restoreDraft rehydrates the doc, drops the history, needs its template", () => {
    const { setZoneStyle, doc: original, template } = useEditor.getState()
    setZoneStyle(original!.layers[0]!.id, { fill: "#123456" })
    const json = (serializeDraft(useEditor.getState().doc, template) as { json: string }).json
    memoryStorage.setItem(DRAFT_KEY, json)

    // wipe the session, then hand the draft back
    useEditor.setState({ template: null, doc: null, past: [], future: [], selectedId: "gone" })
    expect(useEditor.getState().restoreDraft([])).toBe(false) // template gone → draft dropped
    expect(memoryStorage.getItem(DRAFT_KEY)).toBeNull()

    memoryStorage.setItem(DRAFT_KEY, json)
    expect(useEditor.getState().restoreDraft([TPL])).toBe(true)
    const state = useEditor.getState()
    const layer = state.doc!.layers[0]!
    expect(layer.type === "text" && layer.style.fill).toBe("#123456")
    expect(state.template).toBe(TPL)
    expect(state.past).toHaveLength(0)
    expect(state.selectedId).toBeNull()
  })
})
