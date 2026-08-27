import { useEffect, useState } from "react"

// Hand-rolled hash router (family pattern — the router owns the URL).
// Routes: #/ (editor), #/wall, #/add-template, #/paper, #/edit/<templateId>

export type Route =
  | { view: "editor"; templateId?: string }
  | { view: "wall" }
  | { view: "add-template" }
  | { view: "paper" }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "")
  if (h === "wall" || h.startsWith("wall/")) return { view: "wall" }
  if (h === "add-template") return { view: "add-template" }
  if (h === "paper") return { view: "paper" }
  if (h.startsWith("edit/")) {
    const templateId = decodeURIComponent(h.slice("edit/".length))
    return templateId ? { view: "editor", templateId } : { view: "editor" }
  }
  return { view: "editor" }
}

export function navigate(to: string): void {
  window.location.hash = to
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  return route
}
