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
import { analyzeMediaPath, MIN_VIDEO_SIZE_BYTES } from '../../core/naming/index.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { matchStateFor } from '../../core/scanner/scan-plan.ts'
import type { Source, SourceRepository } from '../../core/source/source.ts'
import type { ApplyMatch } from './apply-match.ts'
import { requestImages } from './match-source.ts'
import type { RefreshMetadata } from './refresh-metadata.ts'
import type { Resolution, ResolveMatch } from './resolve-match.ts'

type Deps = {
  tmdb: TmdbApi
  resolveMatch: ResolveMatch
  applyMatch: ApplyMatch
  /**
   * §9.1: a tree written with other settings than its deciding library's is refreshed, and so is
   * the one a file leaves when its deciding library changes.
   */
  refresh: Pick<RefreshMetadata, 'queueIfContextDiffers' | 'filesLeaving'>
  items: MetadataItemRepository
  sourceRepository: Pick<SourceRepository, 'findById' | 'patch'>
  libraryRepository: Pick<LibraryRepository, 'findById'>
  manualMatches: ManualMatchRepository
  settings: Pick<MetadataSettings, 'language'>
  playbackSessions: PlaybackSessionTerminator
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

/** What an admin decides (§7.8): a movie, an episode of a series, or (rematch of a series) a series. */
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

/** An episode file the new series has no episode for (rematch of a series): left for review. */
export type EpisodeNotFound = { sourceId: string; seasonNumber: number; episodeNumber: number }

export type AssignResult = {
  sourceIds: string[]
  itemIds: string[]
  needsReview: EpisodeNotFound[]
}

type Matched = Exclude<Resolution, { kind: 'review' }>

/** A decision checked against TMDB, not written yet. */
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

/**
 * "To review" and "Fix the match" (§7.8, journey 5). Every correction is written to
 * `manual_matches` before it is applied: it wins over the automatic matching at every later
 * scan, full scans included.
 */
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
  playbackSessions,
  jobQueue,
  clock,
  logger,
}: Deps) => {
  /**
   * One source, one decision, checked against TMDB (nothing written). `current`: season and
   * episode of its current episode item.
   */
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

  /** Remembers then writes a prepared decision; returns the items the source now belongs to. */
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

  const episodeNotFound = (prepared: Extract<Prepared, { kind: 'not_found' }>) =>
    err(
      appError('metadata/episode_not_found', 'TMDB has no such season or episode', {
        context: { sourceId: prepared.source.id, ...prepared.at },
      }),
    )

  const sourceNotFound = (id: string) =>
    err(appError('source/not_found', 'source not found', { context: { id } }))

  return {
    /** `GET /admin/tmdb/search`. */
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

    /** `POST /admin/sources/:id/assign`: "it's a movie" / "it's an episode of…". */
    assignSource: async (input: {
      sourceId: string
      assignment: Assignment
      accountId: string
    }): Promise<Result<AssignResult, AssignError>> => {
      const source = sourceRepository.findById(input.sourceId)
      if (source === undefined) return sourceNotFound(input.sourceId)
      const prepared = await prepare(source, input.assignment)
      if (!prepared.ok) return prepared
      if (prepared.value.kind === 'not_found') return episodeNotFound(prepared.value)
      const applied = commit(prepared.value, input.accountId)
      requestImages(jobQueue, applied.enriched)
      logger.info('source assigned', { sourceId: source.id, itemIds: applied.itemIds })
      return ok({ sourceIds: [source.id], itemIds: applied.itemIds, needsReview: [] })
    },

    /** `POST /admin/sources/:id/reject` (§7.8 "Hide"): out of every list and scan until restored. */
    rejectSource: ({
      sourceId,
    }: {
      sourceId: string
    }): Result<void, AppError<'source/not_found'>> => {
      const source = sourceRepository.findById(sourceId)
      if (source === undefined) return sourceNotFound(sourceId)
      const settle = refresh.filesLeaving({ sourceIds: [sourceId] })
      items.transaction(() => {
        const previous = items.linkedItems(sourceId).map((item) => item.id)
        // Back to "not identified": if a full scan presents it again, the matching (and a
        // correction remembered for it) runs again.
        sourceRepository.patch(sourceId, {
          state: 'rejected',
          matchState: 'unmatched',
          reviewReason: undefined,
        })
        items.replaceLinks({ sourceId, itemIds: [] })
        items.pruneOrphans(previous, (pruned) => playbackSessions.endWithin({ itemIds: pruned }))
      })
      settle()
      logger.info('source rejected', { sourceId })
      return ok()
    },

    /**
     * `POST /admin/sources/:id/restore` (§7.8 "Show again"): a hidden source goes through the
     * pipeline again, checked now: its name is read again (a name to review is back in "To
     * review"), then the probe, then the matching (a remembered correction applies again).
     */
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
      jobQueue.enqueue({
        type: 'probe_source',
        payload: { sourceId, mode: 'recheck' },
        dedupeKey: `source:${sourceId}`,
        priority: 80,
      })
      logger.info('source restored', { sourceId })
      return ok()
    },

    /**
     * `POST /admin/items/:id/rematch` ("Fix the match", §7.8): every source of the
     * item (of its episodes for a series) is assigned again. Episodes keep their season and
     * episode numbers unless the body sets them.
     */
    rematchItem: async (input: {
      itemId: string
      assignment: Assignment
      accountId: string
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
      // Every file checked against TMDB first: nothing is written if one of them fails.
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
      // A movie or an episode: one file, one decision, refused as a whole.
      if (single && notFound[0] !== undefined) return episodeNotFound(notFound[0])
      // A series: the episodes the new series lacks wait in "To review", the others move.
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
          sourceIds.push(entry.source.id)
          for (const id of applied.itemIds) itemIds.add(id)
          enriched.push(...applied.enriched)
        }
      })
      requestImages(jobQueue, enriched)
      const needsReview = notFound.map((entry) => ({ sourceId: entry.source.id, ...entry.at }))
      logger.info('item re-identified', {
        itemId: item.id,
        sourceIds,
        needsReview: needsReview.length,
      })
      return ok({ sourceIds, itemIds: [...itemIds], needsReview })
    },
  }
}

export type Review = ReturnType<typeof reviewFactory>
