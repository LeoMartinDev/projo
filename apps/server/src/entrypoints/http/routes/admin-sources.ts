import { Hono } from 'hono'

import {
  type PurgeMissingResponse,
  purgeMissingBodySchema,
  type SourceDto,
  sourcesQuerySchema,
} from '@projo/shared/api/libraries'
import { type AssignResponse, assignBodySchema } from '@projo/shared/api/metadata'

import type { AssignResult, Review } from '../../../application/metadata/review.ts'
import type { MissingSourcesAdmin } from '../../../application/operations/types.ts'
import type { SourceAdmin } from '../../../application/scanner/source-admin.ts'
import { sourceVersionOf } from '../../../core/media/version.ts'
import type { SourceListItem } from '../../../core/source/source.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { noContent } from '../responses.ts'
import { validate } from '../validation.ts'
import { toParsedNameDto } from './sources-dto.ts'

const baseName = (relativePath: string): string => relativePath.split('/').at(-1) ?? relativePath

const iso = <K extends string>(key: K, value: Date | undefined) =>
  (value === undefined ? {} : { [key]: value.toISOString() }) as { [P in K]?: string }

export const toAssignResponse = ({
  sourceIds,
  itemIds,
  needsReview,
}: AssignResult): AssignResponse => ({ sourceIds, itemIds, needsReview })

export const toSourceDto = (source: SourceListItem): SourceDto => ({
  id: source.id,
  libraryId: source.libraryId,
  rootId: source.rootId,
  path:
    source.rootPath === '/'
      ? `/${source.relativePath}`
      : `${source.rootPath}/${source.relativePath}`,
  relativePath: source.relativePath,
  state: source.state,
  sizeBytes: source.sizeBytes,
  discoveredAt: source.discoveredAt.toISOString(),
  classification: source.classification,
  displayTitle: source.parsed.title ?? source.parsed.series ?? baseName(source.relativePath),
  matchState: source.matchState,
  parsed: toParsedNameDto(source.parsed),
  itemIds: source.itemIds,
  items: source.items,
  ...(source.pendingReason === undefined ? {} : { pendingReason: source.pendingReason }),
  ...iso('pendingSince', source.pendingSince),
  ...(source.state === 'pending' ? iso('unchangedSince', source.unchangedSince) : {}),
  ...iso('stableSince', source.stableSince),
  ...iso('readyAt', source.readyAt),
  ...iso('missingSince', source.missingSince),
  ...(source.reviewReason === undefined ? {} : { reviewReason: source.reviewReason }),
  version: sourceVersionOf(source.probe?.video[0], source.parsed),
  ...(source.probe === undefined ? {} : { durationMs: Math.round(source.probe.durationMs) }),
})

export const adminSourcesRoutes = ({ sourceAdmin }: { sourceAdmin: SourceAdmin }) =>
  new Hono<AppEnv>()
    .get('/sources', validate('query', sourcesQuerySchema), (c) => {
      const { libraryId, state, matchState, cursor, limit } = c.req.valid('query')
      const page = sourceAdmin.list({
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
      const result = sourceAdmin.recheck({ id: c.req.param('id') })
      return result.ok ? c.json(result.value, 202) : respondError(c, result.error)
    })

export type AdminSourcesRoutes = ReturnType<typeof adminSourcesRoutes>

export const adminSourceReviewRoutes = ({ review }: { review: Review }) =>
  new Hono<AppEnv>()
    .post('/sources/:id/assign', validate('json', assignBodySchema), async (c) => {
      const account = c.get('account')
      if (account === undefined) throw new Error('admin route without account')
      const result = await review.assignSource({
        sourceId: c.req.param('id'),
        assignment: c.req.valid('json'),
        accountId: account.id,
      })
      return result.ok ? c.json(toAssignResponse(result.value), 200) : respondError(c, result.error)
    })
    .post('/sources/:id/reject', (c) => {
      const result = review.rejectSource({ sourceId: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })
    .post('/sources/:id/restore', (c) => {
      const result = review.restoreSource({ sourceId: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })

export type AdminSourceReviewRoutes = ReturnType<typeof adminSourceReviewRoutes>

export const adminMissingSourcesRoutes = ({ missing }: { missing: MissingSourcesAdmin }) =>
  new Hono<AppEnv>()
    .post('/sources/purge-missing', validate('json', purgeMissingBodySchema), (c) => {
      const { libraryId } = c.req.valid('json')
      const result = missing.purgeAll(libraryId === undefined ? {} : { libraryId })
      return c.json(result satisfies PurgeMissingResponse, 200)
    })
    .delete('/sources/:id', (c) => {
      const result = missing.purge({ sourceId: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })

export type AdminMissingSourcesRoutes = ReturnType<typeof adminMissingSourcesRoutes>
