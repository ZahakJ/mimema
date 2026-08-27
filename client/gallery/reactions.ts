// Which reactions this browser has already spent, slug → emoji[]. Purely a
// courtesy guard: the server counts whatever it is sent, so this only keeps
// honest visitors from double-tapping.

const KEY = "mimema:v1:reacted"

type Spent = Record<string, string[]>

function read(): Spent {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Spent) : {}
  } catch {
    return {}
  }
}

export function reactedWith(slug: string): string[] {
  return read()[slug] ?? []
}

export function markReacted(slug: string, emoji: string): void {
  try {
    const spent = read()
    const list = spent[slug] ?? []
    if (list.includes(emoji)) return
    spent[slug] = [...list, emoji]
    localStorage.setItem(KEY, JSON.stringify(spent))
  } catch {
    /* private mode, quota — reacting still works, it just won't be remembered */
  }
}
