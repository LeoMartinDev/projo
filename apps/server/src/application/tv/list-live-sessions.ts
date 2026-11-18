import type { Clock } from '../../core/clock.ts'
import {
  type ActiveLiveSessionView,
  isLiveSessionExpired,
  type LiveSessionDirectory,
  type LiveSessionRepository,
} from '../../core/tv/live-session.ts'

/** The live sessions of Admin → Sessions, newest first (§29.4). */
export const listLiveSessionsFactory =
  ({
    liveSessions,
    directory,
    clock,
  }: {
    liveSessions: Pick<LiveSessionRepository, 'list'>
    directory: LiveSessionDirectory
    clock: Clock
  }) =>
  (): ActiveLiveSessionView[] => {
    const now = clock.now()
    return directory.describe(
      liveSessions.list().filter((session) => !isLiveSessionExpired(session, now)),
    )
  }

export type ListLiveSessions = ReturnType<typeof listLiveSessionsFactory>
