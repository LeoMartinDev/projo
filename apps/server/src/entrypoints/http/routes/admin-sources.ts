import { Hono } from 'hono'

import {
  type PurgeMissingResponse,
  purgeMissingBodySchema,
  type SourceDto,
  sourcesQuerySchema,
} from '@projo/shared/api/libraries'
import { type AssignResponse, assignBodySchema } from '@projo/shared/api/metadata'

import type { AssignSource } from '../../../application/metadata/assign-source.ts'
import type { RejectSource } from '../../../application/metadata/reject-source.ts'
import type { RestoreSource } from '../../../application/metadata/restore-source.ts'
import type { AssignResult } from '../../../application/metadata/shared/source-assignment.ts'
import type { PurgeAllMissingSources } from '../../../application/operations/purge-all-missing-sources.ts'
import type { PurgeMissingSource } from '../../../application/operations/purge-missing-source.ts'
import type { ListSources } from '../../../application/scanner/list-sources.ts'
import type { RecheckSource } from '../../../application/scanner/recheck-source.ts'
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
  assignSource,
  rejectSource,
  restoreSource,
}: {
  assignSource: AssignSource
  rejectSource: RejectSource
  restoreSource: RestoreSource
}) =>
  new Hono<AppEnv>()
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
