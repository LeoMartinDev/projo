import type { PlaybackHeartbeatBody } from '@projo/shared/api/playback'

export type SessionEnds = {
  endOnce: (sessionId: string, last: PlaybackHeartbeatBody) => Promise<void>
  forget: (sessionId: string) => void
  isLetGo: (sessionId: string) => boolean
  retain: (sessionId: string) => void
  release: (sessionId: string, end: () => Promise<unknown>) => void
  settled: () => Promise<void>
}

export const createSessionEnds = ({
  end,
  defer,
}: {
  end: (sessionId: string, last: PlaybackHeartbeatBody) => Promise<void>
  defer: (callback: () => void) => () => void
}): SessionEnds => {
  const ending = new Map<string, Promise<void>>()
  const ended = new Set<string>()
  const releasing = new Map<string, { done: Promise<void>; cancel: () => void }>()

  const endOnce = (sessionId: string, last: PlaybackHeartbeatBody): Promise<void> => {
    const running = ending.get(sessionId)
    if (running !== undefined) return running
    if (ended.has(sessionId)) return Promise.resolve()
    ended.add(sessionId)
    const done = end(sessionId, last)
      .catch(() => undefined)
      .finally(() => ending.delete(sessionId))
    ending.set(sessionId, done)
    return done
  }

  const retain = (sessionId: string) => {
    releasing.get(sessionId)?.cancel()
  }

  const release = (sessionId: string, finish: () => Promise<unknown>) => {
    retain(sessionId)
    let resolve = () => {}
    const done = new Promise<void>((settled) => {
      resolve = settled
    })
    const settle = () => {
      if (releasing.get(sessionId)?.done === done) releasing.delete(sessionId)
      resolve()
    }
    let started = false
    const cancelTick = defer(() => {
      started = true
      void finish().then(settle, settle)
    })
    releasing.set(sessionId, {
      done,
      cancel: () => {
        if (started) return
        cancelTick()
        settle()
      },
    })
  }

  return {
    endOnce,
    forget: (sessionId) => {
      ended.add(sessionId)
    },
    isLetGo: (sessionId) => ended.has(sessionId),
    retain,
    release,
    settled: async () => {
      await Promise.all([
        ...ending.values(),
        ...[...releasing.values()].map((pending) => pending.done),
      ])
    },
  }
}
