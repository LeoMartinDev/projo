import { Hono } from 'hono'

import {
  type PurgeMissingResponse,
  purgeMissingBodySchema,
  type RejectGroupResponse,
  type ReviewGroupFilesResponse,
  type ReviewGroupsPage,
  reviewGroupsQuerySchema,
  sourcesQuerySchema,
} from '@projo/shared/api/libraries'
import { type AssignResponse, assignBodySchema } from '@projo/shared/api/metadata'

import type { AssignSource } from '../../../application/metadata/assign-source.ts'
import type { GetReviewGroup } from '../../../application/metadata/get-review-group.ts'
import type { ListReviewGroups } from '../../../application/metadata/list-review-groups.ts'
import type { RejectSourceGroup } from '../../../application/metadata/reject-source-group.ts'
import type { RejectSource } from '../../../application/metadata/reject-source.ts'
import type { RestoreSource } from '../../../application/metadata/restore-source.ts'
import type { AssignResult } from '../../../application/metadata/shared/source-assignment.ts'
import type { PurgeAllMissingSources } from '../../../application/operations/purge-all-missing-sources.ts'
import type { PurgeMissingSource } from '../../../application/operations/purge-missing-source.ts'
import type { ListSources } from '../../../application/scanner/list-sources.ts'
import type { RecheckSource } from '../../../application/scanner/recheck-source.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { noContent } from '../responses.ts'
import { validate } from '../validation.ts'
import { toReviewGroupDto, toSourceDto } from './sources-dto.ts'

export const toAssignResponse = ({
  sourceIds,
  itemIds,
  needsReview,
}: AssignResult): AssignResponse => ({ sourceIds, itemIds, needsReview })

export const adminSourcesRoutes = ({
  listSources,
  recheckSource,
}: {
  listSources: ListSources
  recheckSource: RecheckSource
}) =>
  new Hono<AppEnv>()
    .get('/sources', validate('query', sourcesQuerySchema), (c) => {
      const { libraryId, state, matchState, cursor, limit } = c.req.valid('query')
      const page = listSources({
        limit,
        ...(libraryId === undefined ? {} : { libraryId }),
        ...(state === undefined ? {} : { state }),
        ...(matchState === undefined ? {} : { matchState }),
        ...(cursor === undefined ? {} : { cursor }),
      })
      return c.json(
        {
          total: page.total,
          items: page.items.map(toSourceDto),
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        },
        200,
      )
    })
    .post('/sources/:id/recheck', (c) => {
      const result = recheckSource({ id: c.req.param('id') })
      return result.ok ? c.json(result.value, 202) : respondError(c, result.error)
    })

export type AdminSourcesRoutes = ReturnType<typeof adminSourcesRoutes>

export const adminSourceReviewRoutes = ({
  listReviewGroups,
  getReviewGroup,
  assignSource,
  rejectSource,
  rejectSourceGroup,
  restoreSource,
}: {
  listReviewGroups: ListReviewGroups
  getReviewGroup: GetReviewGroup
  assignSource: AssignSource
  rejectSource: RejectSource
  rejectSourceGroup: RejectSourceGroup
  restoreSource: RestoreSource
}) =>
  new Hono<AppEnv>()
    .get('/sources/review-groups', validate('query', reviewGroupsQuerySchema), (c) => {
      const { libraryId, cursor, limit } = c.req.valid('query')
      const page = listReviewGroups({
        limit,
        ...(libraryId === undefined ? {} : { libraryId }),
        ...(cursor === undefined ? {} : { cursor }),
      })
      const body: ReviewGroupsPage = {
        total: page.total,
        items: page.items.map(toReviewGroupDto),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      }
      return c.json(body, 200)
    })
    .get('/sources/:id/review-group', (c) => {
      const result = getReviewGroup({ sourceId: c.req.param('id') })
      if (!result.ok) return respondError(c, result.error)
      const body: ReviewGroupFilesResponse = { items: result.value.files.map(toSourceDto) }
      return c.json(body, 200)
    })
    .post('/sources/:id/assign', validate('json', assignBodySchema), async (c) => {
      const account = c.get('account')
      if (account === undefined) throw new Error('admin route without account')
      const result = await assignSource({
        sourceId: c.req.param('id'),
        assignment: c.req.valid('json'),
        accountId: account.id,
      })
      return result.ok ? c.json(toAssignResponse(result.value), 200) : respondError(c, result.error)
    })
    .post('/sources/:id/reject', (c) => {
      const result = rejectSource({ sourceId: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })
    .post('/sources/:id/reject-group', (c) => {
      const result = rejectSourceGroup({ sourceId: c.req.param('id') })
      return result.ok
        ? c.json(result.value satisfies RejectGroupResponse, 200)
        : respondError(c, result.error)
    })
    .post('/sources/:id/restore', (c) => {
      const result = restoreSource({ sourceId: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })

export type AdminSourceReviewRoutes = ReturnType<typeof adminSourceReviewRoutes>

export const adminMissingSourcesRoutes = ({
  purgeMissingSource,
  purgeAllMissingSources,
}: {
  purgeMissingSource: PurgeMissingSource
  purgeAllMissingSources: PurgeAllMissingSources
}) =>
  new Hono<AppEnv>()
    .post('/sources/purge-missing', validate('json', purgeMissingBodySchema), (c) => {
      const { libraryId } = c.req.valid('json')
      const result = purgeAllMissingSources(libraryId === undefined ? {} : { libraryId })
      return c.json(result satisfies PurgeMissingResponse, 200)
    })
    .delete('/sources/:id', (c) => {
      const result = purgeMissingSource({ sourceId: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })

export type AdminMissingSourcesRoutes = ReturnType<typeof adminMissingSourcesRoutes>
