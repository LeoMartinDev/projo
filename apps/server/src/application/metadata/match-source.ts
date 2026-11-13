import { type AppError, err, ok, type Result } from '@projo/shared'
import type { ReviewReason } from '@projo/shared/api/metadata'

import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  ManualMatch,
  ManualMatchRepository,
  MetadataSettings,
} from '../../core/metadata/ports.ts'
import type { TmdbError } from '../../core/metadata/tmdb.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
import type { Source, SourceRepository } from '../../core/source/source.ts'
import type { QueueRefreshIfContextDiffers } from './queue-refresh-if-context-differs.ts'
import type { ApplyMatch } from './shared/apply-match.ts'
import { requestImages } from './shared/request-images.ts'
import type { Resolution, ResolveMatch } from './shared/resolve-match.ts'
import { TMDB_NOTIFICATION_KEY } from './shared/tmdb-notification-key.ts'

const PARSER_REVIEW_REASONS = new Set<ReviewReason>([
  'classification_ambiguous',
  'date_based',
  'hint_conflict',
  'no_episode_number',
])

type Deps = {
  sourceRepository: Pick<SourceRepository, 'findById' | 'patch'>
  libraryRepository: Pick<LibraryRepository, 'findById'>
  manualMatches: ManualMatchRepository
  settings: MetadataSettings
  resolveMatch: ResolveMatch
  applyMatch: ApplyMatch
  queueRefreshIfContextDiffers: QueueRefreshIfContextDiffers
  notifier: AdminNotifier
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

export type MatchOutcome =
  'matched' | 'manual' | 'needs_review' | 'skipped' | 'no_key' | 'unauthorized'

export type MatchSourceError = AppError<
  'metadata/tmdb_unavailable' | 'metadata/tmdb_invalid_response'
>

export const matchSourceFactory = ({
  sourceRepository,
  libraryRepository,
  manualMatches,
  settings,
  resolveMatch,
  applyMatch,
  queueRefreshIfContextDiffers,
  notifier,
  jobQueue,
  clock,
  logger,
}: Deps) => {
  const resolveManual = (
    match: ManualMatch,
    source: Source,
    language: string,
  ): Promise<Result<Resolution, TmdbError>> =>
    match.kind === 'movie'
      ? resolveMatch.movie(match.tmdbId, language)
      : resolveMatch.episodes(
          match.tmdbId,
          source.parsed,
          language,
          match.episodeNumber === undefined
            ? undefined
            : { seasonNumber: match.seasonNumber ?? 1, episodeNumber: match.episodeNumber },
        )

  const failure = (source: Source, error: TmdbError): Result<MatchOutcome, MatchSourceError> => {
    switch (error.code) {
      case 'metadata/tmdb_key_missing':
        notifier.notify({
          kind: 'metadata/tmdb_key_missing',
          severity: 'warning',
          key: TMDB_NOTIFICATION_KEY,
          context: {},
        })
        return ok('no_key')
      case 'metadata/tmdb_unauthorized':
        notifier.notify({
          kind: 'tmdb/unauthorized',
          severity: 'error',
          key: TMDB_NOTIFICATION_KEY,
          context: {},
        })
        return ok('unauthorized')
      case 'metadata/tmdb_not_found':
        applyMatch.review(source.id, 'no_match')
        return ok('needs_review')
      case 'metadata/tmdb_unavailable':
      case 'metadata/tmdb_invalid_response':
        return err({ ...error, code: error.code })
    }
  }

  return async ({
    sourceId,
  }: {
    sourceId: string
  }): Promise<Result<MatchOutcome, MatchSourceError>> => {
    const source = sourceRepository.findById(sourceId)
    if (source === undefined || source.state !== 'ready') return ok('skipped')
    if (source.matchState === 'matched' || source.matchState === 'manual') return ok('skipped')
    const library = libraryRepository.findById(source.libraryId)
    if (library === undefined) return ok('skipped')
    if (settings.tmdbApiKey() === undefined)
      return failure(source, {
        code: 'metadata/tmdb_key_missing',
        message: 'no TMDB API key configured',
      })
    const language = library.metadataLanguage ?? settings.language()
    const log = logger.child({ sourceId, libraryId: source.libraryId })

    const remembered = manualMatches.findFor({
      id: source.id,
      libraryId: source.libraryId,
      relativePath: source.relativePath,
      ...(source.signature === undefined ? {} : { signature: source.signature }),
    })
    const parserReview =
      source.matchState === 'needs_review' &&
      source.reviewReason !== undefined &&
      PARSER_REVIEW_REASONS.has(source.reviewReason)
    if (remembered === undefined && (parserReview || source.classification === 'unknown')) {
      return ok('skipped')
    }

    const resolution =
      remembered !== undefined
        ? await resolveManual(remembered, source, language)
        : await resolveMatch.resolve({
            classification: source.classification === 'movie' ? 'movie' : 'episode',
            parsed: source.parsed,
            language,
          })
    if (!resolution.ok) return failure(source, resolution.error)
    const fresh = sourceRepository.findById(sourceId)
    if (fresh === undefined || fresh.state !== 'ready') return ok('skipped')
    if (fresh.matchState === 'matched' || fresh.matchState === 'manual') return ok('skipped')
    if (resolution.value.kind === 'review') {
      applyMatch.review(source.id, resolution.value.reason)
      log.info('source needs review', { reviewReason: resolution.value.reason })
      return ok('needs_review')
    }
    if (
      remembered !== undefined &&
      (remembered.sourceId !== source.id ||
        remembered.libraryId !== source.libraryId ||
        remembered.relativePath !== source.relativePath)
    ) {
      manualMatches.save({
        ...remembered,
        libraryId: source.libraryId,
        relativePath: source.relativePath,
        ...(source.signature === undefined ? {} : { signature: source.signature }),
        sourceId: source.id,
        createdAt: clock.now(),
      })
    }
    const applied = applyMatch.apply({
      source: { id: source.id, ...(fresh.readyAt === undefined ? {} : { readyAt: fresh.readyAt }) },
      resolution: resolution.value,
      language,
      ratingCountry: library.ratingCountry,
      state: remembered === undefined ? 'matched' : 'manual',
    })
    requestImages(jobQueue, applied.enriched)
    queueRefreshIfContextDiffers({
      itemId: applied.topLevelId,
      language,
      ratingCountry: library.ratingCountry,
    })
    log.info('source identified', { itemIds: applied.itemIds, manual: remembered !== undefined })
    return ok(remembered === undefined ? 'matched' : 'manual')
  }
}

export type MatchSource = ReturnType<typeof matchSourceFactory>
