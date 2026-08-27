import { describe, expect, it } from "vitest"
import { loadConfig } from "./config.ts"

describe("loadConfig", () => {
  it("has production-ready defaults", () => {
    const c = loadConfig({})
    expect(c.host).toBe("127.0.0.1")
    expect(c.port).toBe(8001)
    expect(c.publicOrigin).toBe("http://localhost:8001")
    expect(c.inviteKey).toBe("")
    expect(c.allowVideo).toBe(true)
    expect(c.dataDir).toMatch(/\/data$/)
    expect(c.rateLimit).toEqual({
      verifyKeyPerWindow: 10,
      writePerWindow: 30,
      readPerWindow: 120,
      reactPerWindow: 60,
      windowMs: 60_000,
    })
  })
  it("reads overrides", () => {
    const c = loadConfig({
      PORT: "5900",
      INVITE_KEY: "shh",
      ALLOW_VIDEO: "0",
      DATA_DIR: "/tmp/x",
      NODE_ENV: "production",
      PUBLIC_ORIGIN: "https://memes.example.com",
      RATE_LIMIT_WRITE: "3",
    })
    expect(c.port).toBe(5900)
    expect(c.inviteKey).toBe("shh")
    expect(c.allowVideo).toBe(false)
    expect(c.dataDir).toBe("/tmp/x")
    expect(c.dev).toBe(false)
    expect(c.publicOrigin).toBe("https://memes.example.com")
    expect(c.rateLimit?.writePerWindow).toBe(3)
  })
  it("localhost default origin follows PORT", () => {
    expect(loadConfig({ PORT: "5900" }).publicOrigin).toBe("http://localhost:5900")
  })
  it("RATE_LIMIT=0 disables the limiter", () => {
    expect(loadConfig({ RATE_LIMIT: "0" }).rateLimit).toBeNull()
  })
})
