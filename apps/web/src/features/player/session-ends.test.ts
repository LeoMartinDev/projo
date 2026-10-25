import { describe, expect, test } from 'bun:test'

import { createSessionEnds } from './session-ends.ts'

/** Manual ticks and DELETEs that settle when the test says so. */
const world = () => {
  const ticks: (() => void)[] = []
  const deletes = new Map<string, () => void>()
  const log: string[] = []
  const ends = createSessionEnds({
    end: (sessionId) => {
      log.push(`end ${sessionId}`)
      return new Promise<void>((resolve) => deletes.set(sessionId, resolve))
    },
    defer: (callback) => {
      let cancelled = false
      ticks.push(() => {
        if (!cancelled) callback()
      })
      return () => {
        cancelled = true
      }
    },
  })
  const tick = async () => {
    for (const run of ticks.splice(0)) run()
    await Promise.resolve()
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { ends, tick, deletes, log, flush }
}

const last = { positionMs: 1000, paused: false }

describe('session ends', () => {
  test('a released session holds the next POST back until its DELETE settles', async () => {
    const { ends, tick, deletes, flush } = world()
    // The next episode's player mounts in the same tick as the previous one unmounts.
    ends.release('a', () => ends.endOnce('a', last))
    let posted = false
    void ends.settled().then(() => {
      posted = true
    })
    await flush()
    expect(posted).toBe(false)
    await tick()
    await flush()
    expect(posted).toBe(false)
    deletes.get('a')?.()
    await flush()
    expect(posted).toBe(true)
  })

  test('a retained session (StrictMode remount) is not ended and holds nothing back', async () => {
    const { ends, tick, log, flush } = world()
    ends.release('a', () => ends.endOnce('a', last))
    ends.retain('a')
    let posted = false
    void ends.settled().then(() => {
      posted = true
    })
    await tick()
    await flush()
    expect(posted).toBe(true)
    expect(log).toEqual([])
  })

  test('an end already started is still awaited after a retain', async () => {
    const { ends, tick, deletes, flush } = world()
    ends.release('a', () => ends.endOnce('a', last))
    await tick()
    ends.retain('a')
    let posted = false
    void ends.settled().then(() => {
      posted = true
    })
    await flush()
    expect(posted).toBe(false)
    deletes.get('a')?.()
    await flush()
    expect(posted).toBe(true)
  })

  test('ends once whoever asks, never a forgotten session', async () => {
    const { ends, deletes, log, flush } = world()
    const first = ends.endOnce('a', last)
    expect(ends.endOnce('a', last)).toBe(first)
    ends.forget('b')
    await ends.endOnce('b', last)
    deletes.get('a')?.()
    await first
    await ends.endOnce('a', last)
    await flush()
    expect(log).toEqual(['end a'])
  })
})
