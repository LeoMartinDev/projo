import type { Clock, Timers } from '../application/ports.ts'

type Pending = { at: number; every: number | undefined; callback: () => void }

/** Timers and a clock that only move with `advance`. */
export const createManualTimers = () => {
  let now = 0
  let nextId = 1
  const pending = new Map<number, Pending>()
  const add = (callback: () => void, ms: number, every: number | undefined) => {
    const id = nextId++
    pending.set(id, { at: now + Math.max(0, ms), every, callback })
    return id
  }
  const clear = (handle: unknown) => void pending.delete(handle as number)
  const timers: Timers = {
    setTimeout: (callback, ms) => add(callback, ms, undefined),
    clearTimeout: clear,
    setInterval: (callback, ms) => add(callback, ms, Math.max(1, ms)),
    clearInterval: clear,
  }
  const clock: Clock = { now: () => now }
  const due = () => {
    let first: [number, Pending] | undefined
    for (const entry of pending) if (first === undefined || entry[1].at < first[1].at) first = entry
    return first
  }
  return {
    timers,
    clock,
    now: () => now,
    // Timers and intervals still pending.
    count: () => pending.size,
    advance: (ms: number) => {
      const end = now + ms
      for (let next = due(); next !== undefined && next[1].at <= end; next = due()) {
        const [id, timer] = next
        now = timer.at
        if (timer.every === undefined) pending.delete(id)
        else timer.at += timer.every
        timer.callback()
      }
      now = end
    },
  }
}

export type ManualTimers = ReturnType<typeof createManualTimers>
