# HTTP API

All JSON. Routes marked **key** need the header `x-meme-key: <INVITE_KEY>` and
answer `401 {"error": …}` without it. Errors are `{"error": "<message>"}`.
Unknown `/api/*` paths return 404 JSON rather than the client's `index.html`.

Shapes are defined in [`shared/schema.ts`](../shared/schema.ts).

## Items

An item is a published meme or an uploaded file.

```ts
type ItemDto = {
  slug: string              // "mysterious-gazebo"
  kind: "meme" | "upload"
  title: string             // ≤ 140 characters
  templateId: string | null // the template it was made from, if any
  mime: string
  ext: string               // png | jpg | gif | webp | mp4 | webm
  bytes: number
  width: number | null      // null for video
  height: number | null
  url: string               // "/m/<slug>.<ext>", the raw file
  shareUrl: string          // "/m/<slug>", the OpenGraph page
  createdAt: number         // ms since epoch
  tags: string[]
  reactions: Record<string, number>  // non-zero counts only
  deduped?: true            // upload responses only: these bytes already existed
}
```

| Method and path | | Request | Response |
| --- | --- | --- | --- |
| `GET /api/items` | | query below | `{items: ItemDto[], nextCursor: string \| null}` |
| `GET /api/items/:slug` | | | `ItemDto` |
| `POST /api/items` | key | multipart, below | `201 ItemDto`, or `200` with `deduped: true` |
| `PATCH /api/items/:slug` | key | `{title?, tags?: string[]}` | `ItemDto` |
| `DELETE /api/items/:slug` | key | | `204` |
| `POST /api/items/:slug/react` | | `{emoji: "🔥" \| "💀" \| "🗿"}` | `{emoji, count, reactions}` |
| `GET /api/tags` | | | `[{tag, count}]`, the 100 most used |

**Listing query.** `q` matches title or slug (substring), `template` a
template id, `tag` a tag, `sort` is `new` (default), `old` or `top`, `limit` is
1–100 (default 40), and `cursor` is the previous page's `nextCursor`. `top`
ranks by total reactions and is never paged.

**Upload fields.** `file` (required); `kind` (`meme` or `upload`, default
`upload`); `title`; `templateId` (kept only if the template exists); `tags`,
comma-separated or a JSON array, slugified to `[a-z0-9-]`, at most 8 of at
most 24 characters each.

The file's type is read from its first bytes: PNG, JPEG, GIF, WebP, MP4 or
WebM. Errors: `400` no file, `413` over 12 MB (image) or 40 MB (video), `415`
unsupported type or video disabled, `422` a dimension over 20,000 px.
Identical bytes return the existing item and merge the new tags into it.

```sh
curl -H "x-meme-key: $INVITE_KEY" \
  -F file=@meme.png -F kind=meme -F title="Friday deploys" -F tags=ops,code \
  http://127.0.0.1:8001/api/items
```

## Templates

```ts
type TemplateDto = {
  id: string
  name: string
  source: "imgflip" | "memegen" | "custom" | "seed"
  ext: string
  width: number            // native size
  height: number
  zones: Zone[]
  imageUrl: string         // "/t/<id>.<ext>"
  sourceUrl: string | null // upstream page, for attribution
  createdAt: number
}

type Zone = {
  x: number; y: number; w: number; h: number   // fractions of the image, 0..1
  align: "left" | "center" | "right"
  valign: "top" | "middle" | "bottom"
  angle: number                                 // degrees, clockwise
  placeholder?: string                          // what the caption should say
  style: {
    fontFamily: "Anton" | "Bangers" | "Oswald" | "Inter" | "JetBrains Mono"
    fontFrac: number      // font size / image height
    fill: string; stroke: string
    strokeFrac: number    // stroke width / font size
    allCaps: boolean
    shadow?: { blur: number; dx: number; dy: number; color: string }
  }
}
```

| Method and path | | Request | Response |
| --- | --- | --- | --- |
| `GET /api/templates` | | | `TemplateDto[]`, sorted by name |
| `GET /api/templates/:id` | | | `TemplateDto` |
| `POST /api/templates` | key | multipart: `image`, `meta` = JSON `{name, zones}` | `201 TemplateDto` |
| `DELETE /api/templates/:id` | key | | `204` |

`name` is 1–80 characters and becomes the id (slugified, suffixed `-2`, `-3`, …
on collision); `zones` holds 1–24 zones. The image must be PNG, JPEG, GIF or
WebP. Deleting a template sets `templateId` to null on items made from it.

## Other routes

| Method and path | | |
| --- | --- | --- |
| `GET /healthz` | | `ok` |
| `POST /api/verify-key` | key | `204`; the client uses it to check a key before saving it |
| `GET /m/<slug>.<ext>` | | The file. Supports `Range`; `Cache-Control: immutable`, one year. |
| `GET /m/<slug>` | | HTML page with OpenGraph and Twitter card tags for link previews. |
| `GET /t/<id>.<ext>` | | A template image. |

A media URL never changes content: a new upload always gets a new slug.

## Automation

The forge can be driven by a headless browser without a second render path.

```
/#/edit/<templateId>?c=<caption 1>&c=<caption 2>&title=<title>
```

loads a template with one `c` per zone, in zone order. Zones without a `c`
keep their current text (empty on a fresh load); extra captions are ignored. Encode spaces as `%20`.
`body[data-doc-ready="<templateId>"]` is set once the document, captions,
base image and fonts are loaded. `window.__mimema.exportPng()` then resolves to
a `data:image/png;base64,…` URL produced by the same function as the download
button, at the template's native resolution.

```js
await page.goto(`${origin}/#/edit/drake-hotline-bling?c=tabs&c=spaces`)
await page.waitForSelector('body[data-doc-ready="drake-hotline-bling"]')
const png = await page.evaluate(() => window.__mimema.exportPng())
```

`tools/render-proof.mjs` and the relay both work this way.
