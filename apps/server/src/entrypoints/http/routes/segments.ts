import { Hono } from 'hono'

import type { GetItemSegments } from '../../../application/segments/types.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal, currentProfileId } from '../principal.ts'
import { toItemSegmentsDto } from './segments-dto.ts'

/**
 * `GET /items/:id/segments` (§17.2 Lecture): the known segments of a movie or an episode the
 * active profile sees; the chain's lookups for an admin account. Mounted at `/api/v1`.
 */
export const segmentsRoutes = ({ getItemSegments }: { getItemSegments: GetItemSegments }) =>
  new Hono<AppEnv>().get('/items/:id/segments', (c) => {
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const result = getItemSegments({
      itemId: c.req.param('id'),
      profileId: profileId.value,
      withLookups: currentPrincipal(c).account.role === 'admin',
    })
    return result.ok ? c.json(toItemSegmentsDto(result.value), 200) : respondError(c, result.error)
  })

export type SegmentsRoutes = ReturnType<typeof segmentsRoutes>
