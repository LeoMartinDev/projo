import type { Clock } from '../../core/clock.ts'
import { isLiveSessionExpired, type LiveSessionRepository } from '../../core/tv/live-session.ts'
import type { EndLiveSession } from './end-live-session.ts'

/** Ends the live sessions without heartbeat for 60 s (§29.4); returns how many. */
export const sweepLiveSessionsFactory =
  ({
    liveSessions,
    endLiveSession,
    clock,
  }: {
    liveSessions: Pick<LiveSessionRepository, 'list'>
    endLiveSession: EndLiveSession
    clock: Clock
  }) =>
  (): number => {
    const now = clock.now()
    const expired = liveSessions.list().filter((session) => isLiveSessionExpired(session, now))
    for (const session of expired) endLiveSession({ session, reason: 'timeout' })
    return expired.length
  }

export type SweepLiveSessions = ReturnType<typeof sweepLiveSessionsFactory>
