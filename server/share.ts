import type { ItemDto } from "../shared/schema.ts"

// Minimal server-rendered share page: OG/Twitter tags so links unfurl in
// Discord/Telegram/iMessage, plus a dark page showing the media itself.
// No inline scripts (CSP script-src 'self').

export function renderSharePage(item: ItemDto, origin: string): string {
  const title = esc(item.title || item.slug)
  const rawUrl = `${origin}${item.url}`
  const shareUrl = `${origin}${item.shareUrl}`
  const isVideo = item.mime.startsWith("video/")

  const og = isVideo
    ? [
        `<meta property="og:type" content="video.other">`,
        `<meta property="og:video" content="${rawUrl}">`,
        `<meta property="og:video:secure_url" content="${rawUrl}">`,
        `<meta property="og:video:type" content="${item.mime}">`,
        `<meta name="twitter:card" content="player">`,
      ]
    : [
        `<meta property="og:type" content="website">`,
        `<meta property="og:image" content="${rawUrl}">`,
        `<meta property="og:image:type" content="${item.mime}">`,
        ...(item.width && item.height
          ? [
              `<meta property="og:image:width" content="${item.width}">`,
              `<meta property="og:image:height" content="${item.height}">`,
            ]
          : []),
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:image" content="${rawUrl}">`,
      ]

  const media = isVideo
    ? `<video src="${esc(item.url)}" controls autoplay loop muted playsinline></video>`
    : `<img src="${esc(item.url)}" alt="${title}">`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title} · mimema</title>
<meta property="og:title" content="${title}">
<meta property="og:site_name" content="mimema">
<meta property="og:url" content="${shareUrl}">
${og.join("\n")}
<style>
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:16px;background:#060404;color:#f1ebe6;
    font-family:system-ui,sans-serif;padding:24px;box-sizing:border-box}
  img,video{max-width:min(92vw,960px);max-height:80vh;border-radius:8px;
    box-shadow:0 16px 48px rgba(0,0,0,.5)}
  a{color:#ed313f;text-decoration:none;font-size:14px;letter-spacing:.12em;
    text-transform:uppercase}
  a:hover{text-decoration:underline}
  p{margin:0;color:#a89e97;font-size:15px}
</style>
</head>
<body>
${media}
<p>${title}</p>
<a href="/#/wall">mimema — the wall</a>
</body>
</html>`
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
