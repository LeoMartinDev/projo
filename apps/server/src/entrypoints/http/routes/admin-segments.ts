import { Hono } from 'hono'

import {
  type ApplyToSeasonResponse,
  applyToSeasonBodySchema,
  putSegmentBodySchema,
  segmentTypeParamSchema,
} from '@projo/shared/api/segments'

import type { ApplySegmentsToSeason } from '../../../application/segments/apply-segments-to-season.ts'
import type { RemoveSegment } from '../../../application/segments/remove-segment.ts'
import type { SetManualSegment } from '../../../application/segments/set-manual-segment.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'
import { toItemSegmentsDto } from './segments-dto.ts'

export const adminSegmentsRoutes = ({
  setManualSegment,
  removeSegment,
  applyToSeason,
}: {
  setManualSegment: SetManualSegment
  removeSegment: RemoveSegment
  applyToSeason: ApplySegmentsToSeason
}) =>
  new Hono<AppEnv>()
    .post('/items/:id/segments/apply-to-season', validate('json', applyToSeasonBodySchema), (c) => {
      const { types } = c.req.valid('json')
      const result = applyToSeason({
        itemId: c.req.param('id'),
        ...(types === undefined ? {} : { types }),
      })
      if (!result.ok) return respondError(c, result.error)
      return c.json(result.value satisfies ApplyToSeasonResponse, 200)
    })
    .put(
      '/items/:id/segments/:type',
      validate('param', segmentTypeParamSchema),
      validate('json', putSegmentBodySchema),
      (c) => {
        const result = setManualSegment({
          itemId: c.req.param('id'),
          type: c.req.valid('param').type,
          marker: c.req.valid('json'),
        })
        return result.ok
          ? c.json(toItemSegmentsDto(result.value), 200)
          : respondError(c, result.error)
      },
    )
    .delete('/items/:id/segments/:type', validate('param', segmentTypeParamSchema), (c) => {
      const result = removeSegment({ itemId: c.req.param('id'), type: c.req.valid('param').type })
      return result.ok
        ? c.json(toItemSegmentsDto(result.value), 200)
        : respondError(c, result.error)
    })

export type AdminSegmentsRoutes = ReturnType<typeof adminSegmentsRoutes>
