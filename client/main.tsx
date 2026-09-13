import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"
import "@fontsource/anton"
// meme voices — Bangers ships one weight, Oswald we take at 700 (see FONT_WEIGHT)
import "@fontsource/bangers"
import "@fontsource/oswald/700.css"
import "./styles/tokens.css"
import "./styles/base.css"
import "./styles/components.css"
import "./styles/app.css"
import "./styles/mobile.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { installAutomation } from "./automation.ts"

// window.__mimema before first paint: a headless caller that loads a deep link
// and waits for body[data-doc-ready] must find the hook already there.
installAutomation()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
