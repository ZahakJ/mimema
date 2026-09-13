import { describe, expect, it } from "vitest"
import { COOLDOWN_MS, Gate, seconds } from "./gate.ts"

describe("Gate cooldown", () => {
  it("lets a chat through once per cooldown window", () => {
    const g = new Gate()
    expect(g.admit("a", 0)).toEqual({ ok: true })
    const blocked = g.admit("a", 10_000)
    expect(blocked).toEqual({ ok: false, reason: "cooldown", retryInMs: COOLDOWN_MS - 10_000 })
    expect(g.admit("a", COOLDOWN_MS)).toEqual({ ok: true })
  })

  it("counts the cooldown per chat, not globally", () => {
    const g = new Gate()
    expect(g.admit("a", 0).ok).toBe(true)
    expect(g.admit("b", 0).ok).toBe(true)
    expect(g.admit("a", 1_000).ok).toBe(false)
  })

  it("honours a custom window", () => {
    const g = new Gate({ cooldownMs: 1_000 })
    g.admit("a", 0)
    expect(g.admit("a", 999).ok).toBe(false)
    expect(g.admit("a", 1_000).ok).toBe(true)
  })
})

describe("Gate queue", () => {
  it("refuses beyond maxWaiting", () => {
    const g = new Gate({ cooldownMs: 0, maxWaiting: 2 })
    expect(g.admit("a", 0).ok).toBe(true)
    expect(g.admit("b", 0).ok).toBe(true)
    expect(g.admit("c", 0)).toEqual({ ok: false, reason: "queue-full" })
    expect(g.waiting).toBe(2)
  })

  it("runs one job at a time, in order", async () => {
    const g = new Gate({ cooldownMs: 0, maxWaiting: 5 })
    const log: string[] = []
    const job = (name: string) => async () => {
      log.push(`start ${name}`)
      await new Promise((r) => setTimeout(r, 5))
      log.push(`end ${name}`)
      return name
    }
    g.admit("a", 0)
    g.admit("b", 0)
    const both = Promise.all([g.run(job("a")), g.run(job("b"))])
    expect(log).toEqual([])
    await both
    expect(log).toEqual(["start a", "end a", "start b", "end b"])
    expect(g.waiting).toBe(0)
  })

  it("frees the slot even when a job throws, and keeps the chain alive", async () => {
    const g = new Gate({ cooldownMs: 0 })
    g.admit("a", 0)
    g.admit("b", 0)
    const boom = g.run(async () => {
      throw new Error("nope")
    })
    const after = g.run(async () => "still here")
    await expect(boom).rejects.toThrow("nope")
    await expect(after).resolves.toBe("still here")
    expect(g.waiting).toBe(0)
  })

  it("reopens the queue once jobs start", () => {
    const g = new Gate({ cooldownMs: 0, maxWaiting: 1 })
    g.admit("a", 0)
    expect(g.admit("b", 0).ok).toBe(false)
    void g.run(async () => "done")
    expect(g.waiting).toBe(1) // not decremented until the microtask runs
  })
})

describe("seconds", () => {
  it("rounds up and never says 0s", () => {
    expect(seconds(1)).toBe(1)
    expect(seconds(12_400)).toBe(13)
    expect(seconds(30_000)).toBe(30)
  })
})

describe("Gate cooldown restarts when the job settles", () => {
  it("measures the cooldown from the end of a forge, not its start", async () => {
    let t = 0
    const g = new Gate({ cooldownMs: 30_000, now: () => t })
    expect(g.admit("c")).toEqual({ ok: true })
    // a forge that takes as long as the cooldown itself
    await g.run(async () => {
      t = 25_000
    }, "c")
    t = 31_000
    expect(g.admit("c")).toEqual({ ok: false, reason: "cooldown", retryInMs: 24_000 })
    t = 55_000
    expect(g.admit("c")).toEqual({ ok: true })
  })

  it("restamps on failure too", async () => {
    let t = 0
    const g = new Gate({ cooldownMs: 10_000, now: () => t })
    g.admit("c")
    t = 5_000
    await expect(g.run(async () => { throw new Error("boom") }, "c")).rejects.toThrow("boom")
    t = 12_000
    expect(g.admit("c")).toEqual({ ok: false, reason: "cooldown", retryInMs: 3_000 })
  })
})
