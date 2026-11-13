import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../../core/clock.ts'
import type { LibraryRepository } from '../../../core/library/library.ts'
import type { ManualMatchRepository, MetadataSettings } from '../../../core/metadata/ports.ts'
import type { TmdbError } from '../../../core/metadata/tmdb.ts'
import type { Source } from '../../../core/source/source.ts'
import type { ObserveLeavingFiles } from '../observe-leaving-files.ts'
import type { QueueRefreshIfContextDiffers } from '../queue-refresh-if-context-differs.ts'
import type { ApplyMatch } from './apply-match.ts'
import type { Resolution, ResolveMatch } from './resolve-match.ts'

/** What an admin (or an assistant) says a file is (§7.8). */
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

export type Prepared =
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

export type PreparedMatch = Extract<Prepared, { kind: 'matched' }>

/** Resolves an assignment on TMDB, in the file's library context, without writing anything. */
export const prepareAssignmentFactory =
  ({
    resolveMatch,
    libraryRepository,
    settings,
  }: {
    resolveMatch: Pick<ResolveMatch, 'movie' | 'episodes'>
    libraryRepository: Pick<LibraryRepository, 'findById'>
    settings: Pick<MetadataSettings, 'language'>
  }) =>
  async (
    source: Source,
    assignment: Assignment,
    current?: { seasonNumber?: number; episodeNumber?: number },
  ): Promise<Result<Prepared, AssignError>> => {
    const library = libraryRepository.findById(source.libraryId)
    const language = library?.metadataLanguage ?? settings.language()
    const ratingCountry = library?.ratingCountry ?? 'FR'
    if (assignment.kind === 'movie') {
      const { tmdbId } = assignment
      const resolution = await resolveMatch.movie(tmdbId, language)
      if (!resolution.ok) return resolution
      return ok({
        kind: 'matched',
        source,
        tmdbId,
        resolution: resolution.value,
        language,
        ratingCountry,
      })
    }
    const tmdbId = assignment.kind === 'series' ? assignment.tmdbId : assignment.seriesTmdbId
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
    const at = {
      seasonNumber: explicit.seasonNumber ?? current?.seasonNumber ?? source.parsed.season ?? 1,
      episodeNumber,
    }
    const resolution = await resolveMatch.episodes(tmdbId, source.parsed, language, at)
    if (!resolution.ok) return resolution
    if (resolution.value.kind === 'review') return ok({ kind: 'not_found', source, at })
    return ok({
      kind: 'matched',
      source,
      tmdbId,
      at,
      resolution: resolution.value,
      language,
      ratingCountry,
    })
  }

/** Writes a prepared assignment: remembered as a manual match, then applied. */
export const commitAssignmentFactory =
  ({
    applyMatch,
    observeLeavingFiles,
    queueRefreshIfContextDiffers,
    manualMatches,
    clock,
  }: {
    applyMatch: Pick<ApplyMatch, 'apply'>
    observeLeavingFiles: ObserveLeavingFiles
    queueRefreshIfContextDiffers: QueueRefreshIfContextDiffers
    manualMatches: Pick<ManualMatchRepository, 'save'>
    clock: Clock
  }) =>
  (prepared: PreparedMatch, accountId: string) => {
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
    const settle = observeLeavingFiles({ sourceIds: [source.id] })
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
    queueRefreshIfContextDiffers({
      itemId: applied.topLevelId,
      language: prepared.language,
      ratingCountry: prepared.ratingCountry,
    })
    return applied
  }

export const planOf = (prepared: PreparedMatch): PlannedIdentification => {
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

export const episodeNotFound = (prepared: Extract<Prepared, { kind: 'not_found' }>) =>
  err(
    appError('metadata/episode_not_found', 'TMDB has no such season or episode', {
      context: { sourceId: prepared.source.id, ...prepared.at },
    }),
  )
