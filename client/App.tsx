import { useEffect } from "react"
import { useRoute, navigate, type Route } from "./router.ts"
import { EditorView } from "./editor/EditorView.tsx"
import { GalleryView } from "./gallery/GalleryView.tsx"
import { ZoneEditorView } from "./zone-editor/ZoneEditorView.tsx"
import { PaperView } from "./paper/PaperView.tsx"
import { InviteKeyButton } from "./components/InviteKeyDialog.tsx"
import { Toasts } from "./components/Toasts.tsx"

// `short` and `glyph` are the phone's tab bar; `label` is the desktop titlebar.
const TABS = [
  { hash: "#/", label: "Forge", short: "Forge", glyph: "◱", view: "editor" },
  { hash: "#/wall", label: "The Wall", short: "Wall", glyph: "▦", view: "wall" },
  { hash: "#/add-template", label: "New Template", short: "New", glyph: "⊞", view: "add-template" },
  { hash: "#/paper", label: "White Paper", short: "Paper", glyph: "§", view: "paper" },
] as const

/**
 * The same four links, rendered twice: docked in the titlebar on a desktop and
 * as a thumb-height tab bar at the bottom on a phone. CSS hides one outright,
 * so only one is ever in the accessibility tree.
 */
function Nav({ route, place }: { route: Route; place: "top" | "bottom" }) {
  return (
    <nav className={`mm-nav mm-nav--${place}`}>
      {TABS.map((t) => (
        <a
          key={t.hash}
          href={t.hash}
          aria-current={route.view === t.view ? "page" : undefined}
          className={`mm-nav__tab${route.view === t.view ? " mm-nav__tab--active" : ""}`}
        >
          <span className="mm-nav__glyph" aria-hidden="true">
            {t.glyph}
          </span>
          <span>{place === "bottom" ? t.short : t.label}</span>
        </a>
      ))}
    </nav>
  )
}

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
        <Nav route={route} place="top" />
        <div className="ms-hud__spacer" />
        <InviteKeyButton />
      </header>
      <main className="ms-hud__main">
        {route.view === "editor" && <EditorView templateId={route.templateId} />}
        {route.view === "wall" && <GalleryView />}
        {route.view === "add-template" && <ZoneEditorView />}
        {route.view === "paper" && <PaperView />}
      </main>
      <Nav route={route} place="bottom" />
      <Toasts />
    </div>
  )
}
