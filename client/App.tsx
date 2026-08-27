import { useEffect } from "react"
import { useRoute, navigate } from "./router.ts"
import { EditorView } from "./editor/EditorView.tsx"
import { GalleryView } from "./gallery/GalleryView.tsx"
import { ZoneEditorView } from "./zone-editor/ZoneEditorView.tsx"
import { PaperView } from "./paper/PaperView.tsx"
import { InviteKeyButton } from "./components/InviteKeyDialog.tsx"
import { Toasts } from "./components/Toasts.tsx"

const TABS = [
  { hash: "#/", label: "Forge", view: "editor" },
  { hash: "#/wall", label: "The Wall", view: "wall" },
  { hash: "#/add-template", label: "New Template", view: "add-template" },
  { hash: "#/paper", label: "The Paper", view: "paper" },
] as const

export function App() {
  const route = useRoute()

  useEffect(() => {
    document.body.dataset.appReady = "1"
  }, [])

  return (
    <div className="ms-hud">
      <header className="ms-hud__titlebar">
        <a
          className="ms-hud__mark"
          href="#/"
          onClick={() => navigate("#/")}
          aria-label="Mimema home"
        >
          <span className="ms-hud__app">Mimema</span>
          <span className="ms-hud__sub">μίμημα · that which is imitated</span>
        </a>
        <nav className="mm-nav">
          {TABS.map((t) => (
            <a
              key={t.hash}
              href={t.hash}
              aria-current={route.view === t.view ? "page" : undefined}
              className={`mm-nav__tab${route.view === t.view ? " mm-nav__tab--active" : ""}`}
            >
              {t.label}
            </a>
          ))}
        </nav>
        <div className="ms-hud__spacer" />
        <InviteKeyButton />
      </header>
      <main className="ms-hud__main">
        {route.view === "editor" && <EditorView templateId={route.templateId} />}
        {route.view === "wall" && <GalleryView />}
        {route.view === "add-template" && <ZoneEditorView />}
        {route.view === "paper" && <PaperView />}
      </main>
      <Toasts />
    </div>
  )
}
