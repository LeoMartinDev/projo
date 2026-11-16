import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  ManualMatchRepository,
  MetadataItemRepository,
  MetadataSettings,
} from '../../core/metadata/ports.ts'
import { awaitsReview, type ReviewQueue, reviewGroupOf } from '../../core/source/review-groups.ts'
import type { Source, SourceRepository } from '../../core/source/source.ts'
import type { ObserveLeavingFiles } from './observe-leaving-files.ts'
import type { QueueRefreshIfContextDiffers } from './queue-refresh-if-context-differs.ts'
import type { ApplyMatch } from './shared/apply-match.ts'
import { requestImages } from './shared/request-images.ts'
import type { ResolveMatch } from './shared/resolve-match.ts'
import {
  type AssignmentError,
  type Assignment,
  type AssignResult,
  commitAssignmentFactory,
  episodeNotFound,
  type EpisodeNotFound,
  planOf,
  type PlannedIdentification,
  type Prepared,
  type PreparedMatch,
  prepareAssignmentFactory,
} from './shared/source-assignment.ts'

type Deps = {
  resolveMatch: Pick<ResolveMatch, 'movie' | 'episodes'>
  applyMatch: ApplyMatch
  observeLeavingFiles: ObserveLeavingFiles
  queueRefreshIfContextDiffers: QueueRefreshIfContextDiffers
  items: Pick<MetadataItemRepository, 'transaction'>
  sourceRepository: Pick<SourceRepository, 'findById'>
  reviewQueue: ReviewQueue
  libraryRepository: Pick<LibraryRepository, 'findById'>
  manualMatches: Pick<ManualMatchRepository, 'save'>
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

export type AssignSourceError = AssignmentError | AppError<'source/not_found'>

const keepsOwnNumbers = (prepared: PreparedMatch): boolean => {
  const { parsed } = prepared.source
  return (
    prepared.at?.seasonNumber === (parsed.season ?? 1) &&
    prepared.at.episodeNumber === (parsed.episode ?? parsed.absoluteEpisode)
  )
}

export const assignSourceFactory = ({
  resolveMatch,
  applyMatch,
  observeLeavingFiles,
  queueRefreshIfContextDiffers,
  items,
  sourceRepository,
  reviewQueue,
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

  /** The other files of its series group (§7.8), with the numbers of the episode they sit on. */
  const reviewSiblings = (source: Source) => {
    if (!awaitsReview(source)) return []
    const group = reviewGroupOf(reviewQueue.candidates({ libraryId: source.libraryId }), source.id)
    if (group?.series === undefined) return []
    return group.files.flatMap(({ id, episode }) => {
      const sibling = id === source.id ? undefined : sourceRepository.findById(id)
      return sibling === undefined
        ? []
        : [
            {
              sibling,
              link: {
                ...(episode?.seasonNumber === undefined
                  ? {}
                  : { seasonNumber: episode.seasonNumber }),
                ...(episode?.episodeNumber === undefined
                  ? {}
                  : { episodeNumber: episode.episodeNumber }),
              },
            },
          ]
    })
  }

  return async (input: {
    sourceId: string
    assignment: Assignment
    accountId: string
    dryRun?: boolean
  }): Promise<Result<AssignResult, AssignSourceError>> => {
    const source = sourceRepository.findById(input.sourceId)
    if (source === undefined) {
      return err(
        appError('source/not_found', 'source not found', { context: { id: input.sourceId } }),
      )
    }
    const prepared = await prepare(source, input.assignment)
    if (!prepared.ok) return prepared
    const main = prepared.value
    if (main.kind === 'not_found') return episodeNotFound(main)
    const siblings: Prepared[] = []
    if (input.assignment.kind === 'episode' && keepsOwnNumbers(main)) {
      const along: Assignment = { kind: 'episode', seriesTmdbId: input.assignment.seriesTmdbId }
      for (const { sibling, link } of reviewSiblings(source)) {
        const checked = await prepare(sibling, along, link)
        if (!checked.ok) return checked
        siblings.push(checked.value)
      }
    }
    if (input.dryRun === true) {
      const planned = [main, ...siblings].flatMap((entry) =>
        entry.kind === 'matched' ? [planOf(entry)] : [],
      )
      return ok({
        sourceIds: planned.map((entry) => entry.sourceId),
        itemIds: [],
        needsReview: siblings.flatMap((entry) =>
          entry.kind === 'not_found' ? [{ sourceId: entry.source.id, ...entry.at }] : [],
        ),
        identified: planned,
        dryRun: true,
      })
    }
    const sourceIds: string[] = []
    const itemIds = new Set<string>()
    const enriched: string[] = []
    const needsReview: EpisodeNotFound[] = []
    const identified: PlannedIdentification[] = []
    const write = (entry: PreparedMatch) => {
      const applied = commit(entry, input.accountId)
      identified.push(planOf(entry))
      sourceIds.push(entry.source.id)
      for (const id of applied.itemIds) itemIds.add(id)
      enriched.push(...applied.enriched)
    }
    items.transaction(() => {
      write(main)
      for (const entry of siblings) {
        const fresh = sourceRepository.findById(entry.source.id)
        if (fresh === undefined || !awaitsReview(fresh)) continue
        if (fresh.rootId !== source.rootId || fresh.relativePath !== entry.source.relativePath)
          continue
        if (entry.kind === 'matched') {
          write({ ...entry, source: fresh })
          continue
        }
        applyMatch.review(fresh.id, 'episode_not_found')
        needsReview.push({ sourceId: fresh.id, ...entry.at })
      }
    })
    requestImages(jobQueue, enriched)
    logger.info('source assigned', {
      sourceId: source.id,
      sourceIds,
      needsReview: needsReview.length,
    })
    return ok({ sourceIds, itemIds: [...itemIds], needsReview, identified, dryRun: false })
  }
}

export type AssignSource = ReturnType<typeof assignSourceFactory>
