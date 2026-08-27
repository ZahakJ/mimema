import type {
  ItemDto,
  ItemPage,
  ItemSort,
  TagCountDto,
  TemplateDto,
  TemplateMeta,
} from "../../shared/schema.ts"
import { useAuth } from "../store/authStore.ts"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = useAuth.getState().key
  const headers = new Headers(init.headers)
  if (key) headers.set("x-meme-key", key)
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  verifyKey: async (key: string): Promise<boolean> => {
    const res = await fetch("/api/verify-key", {
      method: "POST",
      headers: { "x-meme-key": key },
    })
    return res.ok
  },

  listTemplates: () => request<TemplateDto[]>("/api/templates"),
  getTemplate: (id: string) => request<TemplateDto>(`/api/templates/${encodeURIComponent(id)}`),

  createTemplate: (image: Blob, meta: TemplateMeta) => {
    const form = new FormData()
    form.set("image", image)
    form.set("meta", JSON.stringify(meta))
    return request<TemplateDto>("/api/templates", { method: "POST", body: form })
  },

  deleteTemplate: (id: string) =>
    request<void>(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listItems: (
    params: {
      q?: string
      template?: string
      tag?: string
      sort?: ItemSort
      cursor?: string
      limit?: number
    } = {},
  ) => {
    const qs = new URLSearchParams()
    if (params.q) qs.set("q", params.q)
    if (params.template) qs.set("template", params.template)
    if (params.tag) qs.set("tag", params.tag)
    if (params.sort && params.sort !== "new") qs.set("sort", params.sort)
    if (params.cursor) qs.set("cursor", params.cursor)
    if (params.limit) qs.set("limit", String(params.limit))
    const suffix = qs.size ? `?${qs}` : ""
    return request<ItemPage>(`/api/items${suffix}`)
  },

  listTags: () => request<TagCountDto[]>("/api/tags"),

  uploadItem: (
    file: Blob,
    fields: {
      title?: string
      kind: "meme" | "upload"
      templateId?: string
      filename?: string
      tags?: string[]
    },
  ) => {
    const form = new FormData()
    form.set("file", file, fields.filename ?? "upload")
    form.set("kind", fields.kind)
    if (fields.title) form.set("title", fields.title)
    if (fields.templateId) form.set("templateId", fields.templateId)
    // the server takes this comma-separated (a JSON array works too)
    if (fields.tags?.length) form.set("tags", fields.tags.join(","))
    return request<ItemDto>("/api/items", { method: "POST", body: form })
  },

  patchItem: (slug: string, patch: { title?: string; tags?: string[] }) =>
    request<ItemDto>(`/api/items/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),

  react: (slug: string, emoji: string) =>
    request<{ emoji: string; count: number; reactions: Record<string, number> }>(
      `/api/items/${encodeURIComponent(slug)}/react`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      },
    ),

  deleteItem: (slug: string) =>
    request<void>(`/api/items/${encodeURIComponent(slug)}`, { method: "DELETE" }),
}
