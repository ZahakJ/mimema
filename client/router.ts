import { useEffect, useState } from "react"

// Hand-rolled hash router (family pattern — the router owns the URL).
// Routes: #/ (editor), #/wall, #/add-template, #/paper, #/edit/<templateId>
//
// #/edit/<templateId> also carries the whole meme as URL state:
//   #/edit/<id>?c=<caption>&c=<caption>…&title=<text>
// one `c` per zone, in zone order, URL-encoded. Fewer than the template has
// zones leaves the rest alone; extras are ignored. A link is an explicit
// intent, so these captions beat whatever draft was left lying around.

export type Route =
  | { view: "editor"; templateId?: string; captions?: string[]; title?: string }
  | { view: "wall" }
  | { view: "add-template" }
  | { view: "paper" }

/** the wall's title cap (see itemPatchSchema) — a link can't smuggle more */
const TITLE_MAX = 140

/** A hand-typed hash can hold a lone `%`; decodeURIComponent throws on it. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "")
  const q = raw.indexOf("?")
  const h = q === -1 ? raw : raw.slice(0, q)
  // URLSearchParams, not hand-rolled splitting: it is the same parser the
  // platform uses and it never throws on a malformed escape.
  const params = new URLSearchParams(q === -1 ? "" : raw.slice(q + 1))

  if (h === "wall" || h.startsWith("wall/")) return { view: "wall" }
  if (h === "add-template") return { view: "add-template" }
  if (h === "paper") return { view: "paper" }
  if (h.startsWith("edit/")) {
    const templateId = safeDecode(h.slice("edit/".length))
    if (!templateId) return { view: "editor" }
    const captions = params.getAll("c")
    const title = (params.get("title") ?? "").trim().slice(0, TITLE_MAX)
    return {
      view: "editor",
      templateId,
      ...(captions.length ? { captions } : {}),
      ...(title ? { title } : {}),
    }
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
