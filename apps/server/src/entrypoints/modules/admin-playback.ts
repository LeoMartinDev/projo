import { listActivePlaybackSessionsFactory } from '../../application/playback/list-active-playback-sessions.ts'
import { stopPlaybackSessionAsAdminFactory } from '../../application/playback/stop-playback-session-as-admin.ts'
import type { PlaybackSession, TerminationReason } from '../../core/playback/session.ts'
import { createSqliteAdminPlaybackSessions } from '../../infrastructure/sqlite/admin-playback-sessions.ts'
import { createSqlitePlaybackSessionRepository } from '../../infrastructure/sqlite/playback-session-repository.ts'
import { adminPlaybackRoutes } from '../http/routes/admin-playback.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

export const buildAdminPlaybackModule = (
  { db, clock, logger }: Platform,
  {
    endSession,
  }: { endSession: (input: { session: PlaybackSession; reason: TerminationReason }) => unknown },
) =>
  defineModule({
    exposes: {
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
    },
  })
