import type { PlaybackHeartbeatBody } from '@projo/shared/api/playback'

/**
 * Bookkeeping of the sessions being let go (§10.6), so a new `POST /playback/sessions` never
 * overlaps the `DELETE` of the previous one (a transcode counted twice, `transcode_limit_reached`
 * with a limit of 1): a track change, a part, and the next episode, whose player mounts before
 * the previous one's end has even started.
 */
export type SessionEnds = {
  /** Last heartbeat then `DELETE`, once per session whoever asks; settles when it is let go. */
  endOnce: (sessionId: string, last: PlaybackHeartbeatBody) => Promise<void>
  /** The session is gone server side (stopped by the admin, expired): nothing to end. */
  forget: (sessionId: string) => void
  /**
   * The page already ended (or forgot) the session: a `playback.session_terminated` for it is the
   * echo of its own `DELETE`, which can arrive before the next session replaces it on screen.
   */
  isLetGo: (sessionId: string) => boolean
  /** A (re)mounted player owns the session again: cancels a pending release (StrictMode). */
  retain: (sessionId: string) => void
  /**
   * Ends the session on the next tick unless a player retains it meanwhile. The end is pending
   * from this call on, synchronously: `settled` waits for it.
   */
  release: (sessionId: string, end: () => Promise<unknown>) => void
  /** Resolves once every session being ended or released is let go (or retained). */
  settled: () => Promise<void>
}

export const createSessionEnds = ({
  end,
  defer,
}: {
  end: (sessionId: string, last: PlaybackHeartbeatBody) => Promise<void>
  /** Runs `callback` on a later tick; returns its cancellation. */
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
      // Once the end has started, retaining no longer stops it: `settled` waits for it.
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
