import { Hono } from 'hono'

import type { AdminPlaybackSessionDto } from '@projo/shared/api/playback'

import type {
  listActivePlaybackSessionsFactory,
  stopPlaybackSessionAsAdminFactory,
} from '../../../application/playback/admin-sessions.ts'
import type { ActivePlaybackSessionView } from '../../../core/playback/admin-sessions.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal } from '../principal.ts'
import { noContent } from '../responses.ts'

const toDto = (session: ActivePlaybackSessionView): AdminPlaybackSessionDto => ({
  id: session.id,
  account: session.account,
  profile: session.profile,
  item: session.item,
  mode: session.mode,
  quality: session.quality ?? 'original',
  burnIn: session.burnIn,
  version: session.version,
  positionMs: session.positionMs,
  ...(session.durationMs === undefined ? {} : { durationMs: session.durationMs }),
  ...(session.device === undefined ? {} : { device: session.device }),
  startedAt: session.startedAt.toISOString(),
  lastHeartbeatAt: session.lastHeartbeatAt.toISOString(),
})

/**
 * `GET /admin/playback/sessions` and `DELETE /admin/playback/sessions/:id` (§10.6, §15 "Sessions
 * actives"). Mounted at `/api/v1/admin`.
 */
export const adminPlaybackRoutes = ({
  listActive,
  stop,
}: {
  listActive: ReturnType<typeof listActivePlaybackSessionsFactory>
  stop: ReturnType<typeof stopPlaybackSessionAsAdminFactory>
}) =>
  new Hono<AppEnv>()
    .get('/playback/sessions', (c) => c.json(listActive().map(toDto), 200))
    .delete('/playback/sessions/:id', (c) => {
      const { account } = currentPrincipal(c)
      const stopped = stop({ sessionId: c.req.param('id'), adminAccountId: account.id })
      return stopped.ok ? noContent(c) : respondError(c, stopped.error)
    })

export type AdminPlaybackRoutes = ReturnType<typeof adminPlaybackRoutes>
