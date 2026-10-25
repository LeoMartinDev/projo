import {
  listActivePlaybackSessionsFactory,
  stopPlaybackSessionAsAdminFactory,
} from '../../application/playback/admin-sessions.ts'
import type { PlaybackSession, TerminationReason } from '../../core/playback/session.ts'
import { createSqliteAdminPlaybackSessions } from '../../infrastructure/sqlite/admin-playback-sessions.ts'
import { createSqlitePlaybackSessionRepository } from '../../infrastructure/sqlite/playback-session-repository.ts'
import { adminPlaybackRoutes } from '../http/routes/admin-playback.ts'
import type { Platform } from './platform.ts'

/**
 * "Active sessions" of the admin (§10.6, §15): who watches what, and "Stop". `endSession`
 * comes from the playback module (ffmpeg stopped, `playback.session_terminated` to the player).
 */
export const buildAdminPlaybackModule = (
  { db, clock, logger }: Platform,
  {
    endSession,
  }: { endSession: (input: { session: PlaybackSession; reason: TerminationReason }) => unknown },
) => ({
  routes: adminPlaybackRoutes({
    listActive: listActivePlaybackSessionsFactory({
      queries: createSqliteAdminPlaybackSessions({ db }),
      clock,
    }),
    stop: stopPlaybackSessionAsAdminFactory({
      sessionRepository: createSqlitePlaybackSessionRepository({ db }),
      endSession,
      logger: logger.child({ module: 'admin-playback' }),
    }),
  }),
})
