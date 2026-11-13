import type { Clock } from '../../core/clock.ts'
import type {
  ActivePlaybackSessionView,
  AdminPlaybackSessionQueries,
} from '../../core/playback/admin-sessions.ts'
import { sessionTimings } from '../../core/playback/session.ts'

export const listActivePlaybackSessionsFactory =
  ({ queries, clock }: { queries: AdminPlaybackSessionQueries; clock: Clock }) =>
  (): ActivePlaybackSessionView[] => {
    const now = clock.now().getTime()
    return queries
      .listActive()
      .filter((session) => now - session.lastHeartbeatAt.getTime() < sessionTimings.expireAfterMs)
  }

export type ListActivePlaybackSessions = ReturnType<typeof listActivePlaybackSessionsFactory>
