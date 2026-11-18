import type { Logger } from '../../core/logger.ts'
import type { LiveSessionRepository } from '../../core/tv/live-session.ts'
import type { EndLiveSession } from './end-live-session.ts'

/**
 * A profile lost Live TV access (§29.6): its live sessions end at once (`ended`: the player tries
 * once more and is refused `tv/channel_not_found`). Returns how many ended.
 */
export const endProfileLiveSessionsFactory =
  ({
    liveSessions,
    endLiveSession,
    logger,
  }: {
    liveSessions: Pick<LiveSessionRepository, 'list'>
    endLiveSession: EndLiveSession
    logger: Logger
  }) =>
  ({ profileId }: { profileId: string }): number => {
    const sessions = liveSessions.list().filter((session) => session.profileId === profileId)
    for (const session of sessions) endLiveSession({ session, reason: 'ended' })
    if (sessions.length > 0)
      logger.info('live sessions ended: live tv access off', { profileId, ended: sessions.length })
    return sessions.length
  }

export type EndProfileLiveSessions = ReturnType<typeof endProfileLiveSessionsFactory>
