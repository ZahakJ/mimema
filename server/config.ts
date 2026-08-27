import path from "node:path"

/** per-IP request caps, counted over windowMs */
export type RateLimitConfig = {
  verifyKeyPerWindow: number
  writePerWindow: number
  readPerWindow: number
  reactPerWindow: number
  windowMs: number
}

export type Config = {
  host: string
  port: number
  publicOrigin: string
  dataDir: string
  /** empty string means publishing is disabled (auth always fails) */
  inviteKey: string
  allowVideo: boolean
  dev: boolean
  /** null turns the limiter off entirely (RATE_LIMIT=0; tests) */
  rateLimit: RateLimitConfig | null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8001)
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    // deliberately generic: a fresh clone must not emit OG tags pointing at
    // someone else's domain. Set PUBLIC_ORIGIN in .env for real deploys.
    publicOrigin: env.PUBLIC_ORIGIN ?? `http://localhost:${port}`,
    dataDir: env.DATA_DIR ?? path.join(import.meta.dirname, "..", "data"),
    inviteKey: env.INVITE_KEY ?? "",
    allowVideo: env.ALLOW_VIDEO !== "0",
    dev: env.NODE_ENV !== "production",
    rateLimit:
      env.RATE_LIMIT === "0"
        ? null
        : {
            verifyKeyPerWindow: num(env.RATE_LIMIT_VERIFY, 10),
            writePerWindow: num(env.RATE_LIMIT_WRITE, 30),
            readPerWindow: num(env.RATE_LIMIT_READ, 120),
            reactPerWindow: num(env.RATE_LIMIT_REACT, 60),
            windowMs: num(env.RATE_LIMIT_WINDOW_MS, 60_000),
          },
  }
}

function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
