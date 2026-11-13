import { appError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  ManualMatchRepository,
  MetadataItemRepository,
  MetadataSettings,
} from '../../core/metadata/ports.ts'
import type { SourceRepository } from '../../core/source/source.ts'
import type { ObserveLeavingFiles } from './observe-leaving-files.ts'
import type { QueueRefreshIfContextDiffers } from './queue-refresh-if-context-differs.ts'
import type { ApplyMatch } from './shared/apply-match.ts'
import { requestImages } from './shared/request-images.ts'
import type { ResolveMatch } from './shared/resolve-match.ts'
import {
  type AssignError,
  type Assignment,
  type AssignResult,
  commitAssignmentFactory,
  episodeNotFound,
  planOf,
  type PlannedIdentification,
  type Prepared,
  prepareAssignmentFactory,
} from './shared/source-assignment.ts'

type Deps = {
  resolveMatch: Pick<ResolveMatch, 'movie' | 'episodes'>
  applyMatch: ApplyMatch
  observeLeavingFiles: ObserveLeavingFiles
  queueRefreshIfContextDiffers: QueueRefreshIfContextDiffers
  items: Pick<MetadataItemRepository, 'transaction' | 'findItem' | 'sourcesUnder'>
  sourceRepository: Pick<SourceRepository, 'findById'>
  libraryRepository: Pick<LibraryRepository, 'findById'>
  manualMatches: Pick<ManualMatchRepository, 'save'>
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

export type RematchItemError = AssignError

export const rematchItemFactory = ({
  resolveMatch,
  applyMatch,
  observeLeavingFiles,
  queueRefreshIfContextDiffers,
  items,
  sourceRepository,
  libraryRepository,
  manualMatches,
  settings,
  jobQueue,
  clock,
  logger,
}: Deps) => {
  const prepare = prepareAssignmentFactory({ resolveMatch, libraryRepository, settings })
  const commit = commitAssignmentFactory({
    applyMatch,
    observeLeavingFiles,
    queueRefreshIfContextDiffers,
    manualMatches,
    clock,
  })

  return async (input: {
    itemId: string
    assignment: Assignment
    accountId: string
    dryRun?: boolean
  }): Promise<Result<AssignResult, RematchItemError>> => {
    const item = items.findItem(input.itemId)
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { id: input.itemId } }))
    }
    const allowed =
      item.kind === 'series'
        ? input.assignment.kind !== 'movie'
        : item.kind === 'movie' || item.kind === 'episode'
    if (!allowed) {
      return err(
        appError('item/invalid_kind', 'this item cannot be identified this way', {
          context: { id: item.id, kind: item.kind, assignment: input.assignment.kind },
        }),
      )
    }
    const prepared: Prepared[] = []
    for (const link of items.sourcesUnder(item.id)) {
      const source = sourceRepository.findById(link.sourceId)
      if (source === undefined) continue
      const checked = await prepare(source, input.assignment, link)
      if (!checked.ok) return checked
      prepared.push(checked.value)
    }
    const single = item.kind !== 'series'
    const notFound = prepared.filter((p) => p.kind === 'not_found')
    if (single && notFound[0] !== undefined) return episodeNotFound(notFound[0])
    const needsReview = notFound.map((entry) => ({ sourceId: entry.source.id, ...entry.at }))
    if (input.dryRun === true) {
      const planned = prepared.flatMap((entry) => (entry.kind === 'matched' ? [planOf(entry)] : []))
      return ok({
        sourceIds: planned.map((entry) => entry.sourceId),
        itemIds: [],
        needsReview,
        identified: planned,
        dryRun: true,
      })
    }
    const identified: PlannedIdentification[] = []
    const sourceIds: string[] = []
    const itemIds = new Set<string>()
    const enriched: string[] = []
    items.transaction(() => {
      for (const entry of prepared) {
        if (entry.kind === 'not_found') {
          applyMatch.review(entry.source.id, 'episode_not_found')
          continue
        }
        const applied = commit(entry, input.accountId)
        identified.push(planOf(entry))
        sourceIds.push(entry.source.id)
        for (const id of applied.itemIds) itemIds.add(id)
        enriched.push(...applied.enriched)
      }
    })
    requestImages(jobQueue, enriched)
    logger.info('item re-identified', {
      itemId: item.id,
      sourceIds,
      needsReview: needsReview.length,
    })
    return ok({ sourceIds, itemIds: [...itemIds], needsReview, identified, dryRun: false })
  }
}

export type RematchItem = ReturnType<typeof rematchItemFactory>
