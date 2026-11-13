import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { TranscodeCache } from '../../core/playback/ports.ts'
import { type PlaybackSessionRepository, sessionTimings } from '../../core/playback/session.ts'
import type { EndPlaybackSession } from './end-playback-session.ts'

export type LiveStreams = {
  sessionIds: () => string[]
  release: (sessionId: string) => void
}

export const sweepPlaybackSessionsFactory =
  ({
    sessionRepository,
    transcodeCache,
    endSession,
    streams,
    clock,
    logger,
  }: {
    sessionRepository: PlaybackSessionRepository
    transcodeCache: TranscodeCache
    endSession: EndPlaybackSession
    streams: LiveStreams
    clock: Clock
    logger: Logger
  }) =>
  (): { expired: number; purged: number; released: number } => {
    const now = clock.now()
    const stale = sessionRepository.listStale({
      notAfter: new Date(now.getTime() - sessionTimings.expireAfterMs),
    })
    for (const session of stale) endSession({ session, reason: 'timeout' })

    const released = new Set<string>()
    for (const sessionId of streams.sessionIds()) {
      const session = sessionRepository.findById(sessionId)
      if (session !== undefined && session.endedAt === undefined) continue
      streams.release(sessionId)
      released.add(sessionId)
      logger.warn('playback stream released without its session', {
        sessionId,
        ...(session === undefined ? { gone: true } : {}),
      })
    }

    let purged = 0
    for (const sessionId of transcodeCache.listSessionIds()) {
      if (released.has(sessionId)) continue
      const session = sessionRepository.findById(sessionId)
      const purgeable =
        session === undefined ||
        (session.endedAt !== undefined &&
          now.getTime() - session.endedAt.getTime() >= sessionTimings.cacheGraceMs)
      if (purgeable) {
        transcodeCache.remove(sessionId)
        purged += 1
      }
    }
    if (stale.length > 0 || purged > 0) {
      logger.debug('playback sessions swept', { expired: stale.length, purged })
    }
    return { expired: stale.length, purged, released: released.size }
  }

export type SweepPlaybackSessions = ReturnType<typeof sweepPlaybackSessionsFactory>
