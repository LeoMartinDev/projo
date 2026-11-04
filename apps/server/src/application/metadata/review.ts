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
import type { TmdbApi, TmdbError, TmdbSearchHit } from '../../core/metadata/tmdb.ts'
import { analyzeMediaPath, MIN_VIDEO_SIZE_BYTES, showFolderOf } from '../../core/naming/index.ts'
import { matchStateFor } from '../../core/scanner/scan-plan.ts'
import type { Source, SourceRepository } from '../../core/source/source.ts'
import { probeJob } from '../scanner/probe-source.ts'
import type { ApplyMatch } from './apply-match.ts'
import { requestImages } from './match-source.ts'
import type { RefreshMetadata } from './refresh-metadata.ts'
import type { Resolution, ResolveMatch } from './resolve-match.ts'

type Deps = {
  tmdb: TmdbApi
  resolveMatch: ResolveMatch
  applyMatch: ApplyMatch
  refresh: Pick<RefreshMetadata, 'queueIfContextDiffers' | 'filesLeaving'>
  items: MetadataItemRepository
  sourceRepository: Pick<SourceRepository, 'findById' | 'patch'>
  libraryRepository: Pick<LibraryRepository, 'findById'>
  manualMatches: ManualMatchRepository
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

export type Assignment =
  | { kind: 'movie'; tmdbId: number }
  | {
      kind: 'episode'
      seriesTmdbId: number
      seasonNumber?: number | undefined
      episodeNumber?: number | undefined
    }
  | { kind: 'series'; tmdbId: number }

export type AssignError =
  | TmdbError
  | AppError<
      | 'source/not_found'
      | 'item/not_found'
      | 'item/invalid_kind'
      | 'metadata/episode_number_required'
      | 'metadata/episode_not_found'
    >

export type EpisodeNotFound = { sourceId: string; seasonNumber: number; episodeNumber: number }

export type PlannedIdentification = {
  sourceId: string
  relativePath: string
  kind: 'movie' | 'episode'
  tmdbId: number
  title: string
  seasonNumber?: number
  episodeNumber?: number
  episodeTitle?: string
}

export type AssignResult = {
  sourceIds: string[]
  itemIds: string[]
  needsReview: EpisodeNotFound[]
  identified: PlannedIdentification[]
  dryRun: boolean
}

type Matched = Exclude<Resolution, { kind: 'review' }>

type Prepared =
  | {
      kind: 'matched'
      source: Source
      tmdbId: number
      at?: { seasonNumber: number; episodeNumber: number }
      resolution: Matched
      language: string
      ratingCountry: string
    }
  | { kind: 'not_found'; source: Source; at: { seasonNumber: number; episodeNumber: number } }

export const reviewFactory = ({
  tmdb,
  resolveMatch,
  applyMatch,
  refresh,
  items,
  sourceRepository,
  libraryRepository,
  manualMatches,
  settings,
  jobQueue,
  clock,
  logger,
}: Deps) => {
  const prepare = async (
    source: Source,
    assignment: Assignment,
    current?: { seasonNumber?: number; episodeNumber?: number },
  ): Promise<Result<Prepared, AssignError>> => {
    const library = libraryRepository.findById(source.libraryId)
    const language = library?.metadataLanguage ?? settings.language()
    const ratingCountry = library?.ratingCountry ?? 'FR'
    let tmdbId: number
    let at: { seasonNumber: number; episodeNumber: number } | undefined
    if (assignment.kind === 'movie') {
      tmdbId = assignment.tmdbId
    } else {
      tmdbId = assignment.kind === 'series' ? assignment.tmdbId : assignment.seriesTmdbId
      const explicit: { seasonNumber?: number | undefined; episodeNumber?: number | undefined } =
        assignment.kind === 'episode' ? assignment : {}
      const episodeNumber =
        explicit.episodeNumber ??
        current?.episodeNumber ??
        source.parsed.episode ??
        source.parsed.absoluteEpisode
      if (episodeNumber === undefined) {
        return err(
          appError('metadata/episode_number_required', 'no episode number to assign', {
            context: { sourceId: source.id },
          }),
        )
      }
      at = {
        seasonNumber: explicit.seasonNumber ?? current?.seasonNumber ?? source.parsed.season ?? 1,
        episodeNumber,
      }
    }
    const resolution =
      at === undefined
        ? await resolveMatch.movie(tmdbId, language)
        : await resolveMatch.episodes(tmdbId, source.parsed, language, at)
    if (!resolution.ok) return resolution
    if (resolution.value.kind === 'review') {
      if (at !== undefined) return ok({ kind: 'not_found', source, at })
      return err(
        appError('metadata/episode_not_found', 'TMDB has no such season or episode', {
          context: { sourceId: source.id, seriesTmdbId: tmdbId },
        }),
      )
    }
    return ok({
      kind: 'matched',
      source,
      tmdbId,
      ...(at === undefined ? {} : { at }),
      resolution: resolution.value,
      language,
      ratingCountry,
    })
  }

  const commit = (prepared: Extract<Prepared, { kind: 'matched' }>, accountId: string) => {
    const { source, tmdbId, at } = prepared
    manualMatches.save({
      libraryId: source.libraryId,
      relativePath: source.relativePath,
      ...(source.signature === undefined ? {} : { signature: source.signature }),
      sourceId: source.id,
      tmdbId,
      kind: at === undefined ? 'movie' : 'episode',
      ...(at === undefined ? {} : at),
      createdBy: accountId,
      createdAt: clock.now(),
    })
    const settle = refresh.filesLeaving({ sourceIds: [source.id] })
    const applied = applyMatch.apply({
      source: {
        id: source.id,
        ...(source.readyAt === undefined ? {} : { readyAt: source.readyAt }),
      },
      resolution: prepared.resolution,
      language: prepared.language,
      ratingCountry: prepared.ratingCountry,
      state: 'manual',
    })
    settle()
    refresh.queueIfContextDiffers({
      itemId: applied.topLevelId,
      language: prepared.language,
      ratingCountry: prepared.ratingCountry,
    })
    return applied
  }

  const planOf = (prepared: Extract<Prepared, { kind: 'matched' }>): PlannedIdentification => {
    const { source, tmdbId, resolution } = prepared
    if (resolution.kind === 'movie') {
      return {
        sourceId: source.id,
        relativePath: source.relativePath,
        kind: 'movie',
        tmdbId,
        title: resolution.movie.title,
      }
    }
    const first = resolution.episodes[0]
    return {
      sourceId: source.id,
      relativePath: source.relativePath,
      kind: 'episode',
      tmdbId,
      title: resolution.series.title,
      ...(prepared.at ?? {}),
      ...(first?.name === undefined ? {} : { episodeTitle: first.name }),
    }
  }

  const episodeNotFound = (prepared: Extract<Prepared, { kind: 'not_found' }>) =>
    err(
      appError('metadata/episode_not_found', 'TMDB has no such season or episode', {
        context: { sourceId: prepared.source.id, ...prepared.at },
      }),
    )

  const sourceNotFound = (id: string) =>
    err(appError('source/not_found', 'source not found', { context: { id } }))

  const awaitsReview = (source: Source): boolean =>
    source.matchState === 'needs_review' && source.state === 'ready'

  const reviewSiblings = (source: Source) => {
    const episode = items.linkedItems(source.id).find((item) => item.kind === 'episode')
    const season = episode?.parentId === undefined ? undefined : items.findItem(episode.parentId)
    if (season?.parentId === undefined) return []
    const folder = showFolderOf(source.relativePath)
    return items.sourcesUnder(season.parentId).flatMap((link) => {
      const sibling =
        link.sourceId === source.id ? undefined : sourceRepository.findById(link.sourceId)
      return sibling !== undefined &&
        awaitsReview(sibling) &&
        sibling.rootId === source.rootId &&
        showFolderOf(sibling.relativePath) === folder
        ? [{ sibling, link }]
        : []
    })
  }

  const keepsOwnNumbers = (prepared: Extract<Prepared, { kind: 'matched' }>): boolean => {
    const { parsed } = prepared.source
    return (
      prepared.at?.seasonNumber === (parsed.season ?? 1) &&
      prepared.at.episodeNumber === (parsed.episode ?? parsed.absoluteEpisode)
    )
  }

  return {
    search: (input: {
      query: string
      kind: 'movie' | 'series'
      year?: number
      language?: string
    }): Promise<Result<TmdbSearchHit[], TmdbError>> => {
      const language = input.language ?? settings.language()
      return input.kind === 'movie'
        ? tmdb.searchMovies({
            query: input.query,
            ...(input.year === undefined ? {} : { year: input.year }),
            language,
          })
        : tmdb.searchSeries({
            query: input.query,
            ...(input.year === undefined ? {} : { firstAirYear: input.year }),
            language,
          })
    },

    assignSource: async (input: {
      sourceId: string
      assignment: Assignment
      accountId: string
      dryRun?: boolean
    }): Promise<Result<AssignResult, AssignError>> => {
      const source = sourceRepository.findById(input.sourceId)
      if (source === undefined) return sourceNotFound(input.sourceId)
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
      const write = (entry: Extract<Prepared, { kind: 'matched' }>) => {
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
    },

    rejectSource: ({
      sourceId,
    }: {
      sourceId: string
    }): Result<void, AppError<'source/not_found'>> => {
      const source = sourceRepository.findById(sourceId)
      if (source === undefined) return sourceNotFound(sourceId)
      const settle = refresh.filesLeaving({ sourceIds: [sourceId] })
      items.transaction(() => {
        sourceRepository.patch(sourceId, {
          state: 'rejected',
          matchState: 'unmatched',
          reviewReason: undefined,
        })
        items.replaceLinks({ sourceId, itemIds: [] })
      })
      settle()
      logger.info('source rejected', { sourceId })
      return ok()
    },

    restoreSource: ({
      sourceId,
    }: {
      sourceId: string
    }): Result<void, AppError<'source/not_found' | 'source/not_rejected'>> => {
      const source = sourceRepository.findById(sourceId)
      if (source === undefined) return sourceNotFound(sourceId)
      if (source.state !== 'rejected') {
        return err(
          appError('source/not_rejected', 'only a hidden source can be shown again', {
            context: { id: sourceId, state: source.state },
          }),
        )
      }
      const analysis = analyzeMediaPath({
        relativePath: source.relativePath,
        hint: libraryRepository.findById(source.libraryId)?.hint ?? 'auto',
      })
      const matchState = matchStateFor(undefined, analysis.reviewReason)
      const now = clock.now()
      sourceRepository.patch(sourceId, {
        state: 'pending',
        pendingReason: source.sizeBytes < MIN_VIDEO_SIZE_BYTES ? 'too_small' : 'growing',
        pendingSince: now,
        unchangedSince: now,
        stableSince: undefined,
        classification: analysis.classification,
        parsed: analysis.parsed,
        matchState,
        reviewReason: matchState === 'needs_review' ? analysis.reviewReason : undefined,
      })
      jobQueue.enqueue({ ...probeJob(sourceId, 'recheck'), priority: 80 })
      logger.info('source restored', { sourceId })
      return ok()
    },

    rematchItem: async (input: {
      itemId: string
      assignment: Assignment
      accountId: string
      dryRun?: boolean
    }): Promise<Result<AssignResult, AssignError>> => {
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
        const planned = prepared.flatMap((entry) =>
          entry.kind === 'matched' ? [planOf(entry)] : [],
        )
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
    },
  }
}

export type Review = ReturnType<typeof reviewFactory>
