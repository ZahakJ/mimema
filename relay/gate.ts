/**
 * Cost guard, not an access control list: anyone in the room may trigger a
 * meme. What we defend against is a room that discovers `!meme` and burns a
 * model call per second — a per-chat cooldown plus a global one-at-a-time
 * queue with a short waiting line.
 */

export const COOLDOWN_MS = 30_000
export const MAX_WAITING = 5

export type Admission =
  | { ok: true }
  | { ok: false; reason: "cooldown"; retryInMs: number }
  | { ok: false; reason: "queue-full" }

export class Gate {
  readonly cooldownMs: number
  readonly maxWaiting: number
  readonly #last = new Map<string, number>()
  readonly #now: () => number
  #waiting = 0
  #chain: Promise<unknown> = Promise.resolve()

  constructor(opts: { cooldownMs?: number; maxWaiting?: number; now?: () => number } = {}) {
    this.cooldownMs = opts.cooldownMs ?? COOLDOWN_MS
    this.maxWaiting = opts.maxWaiting ?? MAX_WAITING
    this.#now = opts.now ?? Date.now
  }

  /** how many admitted jobs have not started running yet */
  get waiting(): number {
    return this.#waiting
  }

  /**
   * Decide whether this chat may trigger a forge right now. On `ok` the
   * cooldown clock restarts and a queue slot is reserved — the caller MUST
   * then pass the job to run(), or the slot leaks.
   */
  admit(chatId: string, now: number = this.#now()): Admission {
    const last = this.#last.get(chatId)
    if (last !== undefined && now - last < this.cooldownMs) {
      return { ok: false, reason: "cooldown", retryInMs: this.cooldownMs - (now - last) }
    }
    if (this.#waiting >= this.maxWaiting) return { ok: false, reason: "queue-full" }
    this.#last.set(chatId, now)
    this.#waiting += 1
    return { ok: true }
  }

  /**
   * Serialize admitted jobs: exactly one runs at a time, in admission order.
   * Pass the chatId and the cooldown clock restarts again when the job
   * settles — a forge takes 20–40s, about the cooldown itself, so a clock that
   * only started at admission would let a room fire back-to-back.
   */
  run<T>(job: () => Promise<T>, chatId?: string): Promise<T> {
    const start = () => {
      this.#waiting = Math.max(0, this.#waiting - 1)
      return job()
    }
    const next = this.#chain.then(start, start)
    const settled = next.finally(() => {
      if (chatId !== undefined) this.#last.set(chatId, this.#now())
    })
    // keep the chain alive even when a job rejects
    this.#chain = settled.catch(() => undefined)
    return settled
  }
}

/** "cooling down, try in 12s" */
export function seconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}
