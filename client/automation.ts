// The headless hook. Mimema has no AI and no API for making memes — but a
// script that can drive a browser gets the deep link (#/edit/<id>?c=…) in and
// the PNG out, with nothing in between but the editor itself.
//
//   await page.goto(`${origin}/#/edit/${id}?c=hello&c=world`)
//   await page.waitForSelector("body[data-doc-ready]")
//   const dataUrl = await page.evaluate(() => window.__mimema.exportPng())
//
// exportPng() is the download button's own path (exportPng.ts → renderMeme at
// native template resolution). There is no second render path, here or ever.
import { useEditor } from "./store/editorStore.ts"
import { exportPng } from "./editor/exportPng.ts"

export type MimemaAutomation = {
  /** the current doc as a `data:image/png;base64,…` URL */
  exportPng: () => Promise<string>
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("could not read the exported PNG"))
    reader.readAsDataURL(blob)
  })
}

export async function exportPngDataUrl(): Promise<string> {
  const { doc, template } = useEditor.getState()
  if (!doc) throw new Error("nothing to export — no template loaded")
  return await blobToDataUrl(await exportPng(doc, template?.imageUrl ?? null))
}

export function installAutomation(): void {
  window.__mimema = { exportPng: exportPngDataUrl }
}
