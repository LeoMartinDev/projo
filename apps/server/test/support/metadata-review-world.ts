import { expect } from 'bun:test'

import { ok, type Result } from '@projo/shared'

import { assignSourceFactory } from '../../src/application/metadata/assign-source.ts'
import { rejectSourceFactory } from '../../src/application/metadata/reject-source.ts'
import { rematchItemFactory } from '../../src/application/metadata/rematch-item.ts'
import { restoreSourceFactory } from '../../src/application/metadata/restore-source.ts'
import { searchTmdbFactory } from '../../src/application/metadata/search-tmdb.ts'
import type { ApplyMatch } from '../../src/application/metadata/shared/apply-match.ts'
import type { Resolution } from '../../src/application/metadata/shared/resolve-match.ts'
import type { Library } from '../../src/core/library/library.ts'
import type { ManualMatch } from '../../src/core/metadata/ports.ts'
import type { TmdbError } from '../../src/core/metadata/tmdb.ts'
import type { ParsedName } from '../../src/core/naming/index.ts'
import type { Source, SourcePatch } from '../../src/core/source/source.ts'
import { createManualClock } from './clock.ts'
import { createRecordingJobQueue } from './fakes.ts'
import { silentLogger } from './logger.ts'
import {
  createFakeTmdb,
  createInMemoryMetadataItems,
  type FakeItem,
  searchHit,
  tmdbEpisode,
  tmdbMovie,
  tmdbSeason,
  tmdbSeries,
} from './metadata-fakes.ts'

/**
 * Fixtures and in-memory fakes of the review use cases (search, assign, reject, restore,
 * rematch), for their unit tests. `metadata-world.ts` is the real one: modules, SQLite and the
 * replayed TMDB server.
 */

export const now = new Date('2026-04-01T10:00:00.000Z')
export const readyAt = new Date('2026-03-30T09:00:00.000Z')
export const DARK = 70523

export const library = (overrides: Partial<Library> = {}): Library => ({
  id: 'lib',
  name: 'Library',
  createdAt: now,
  roots: [],
  hint: 'auto',
  scanIntervalMinutes: 60,
  watchEnabled: true,
  quietPeriodSeconds: 60,
  detectSegments: false,
  preExtractSubtitles: false,
  trickplayEnabled: false,
  metadataLanguage: 'de-DE',
  ratingCountry: 'DE',
  ...overrides,
})

export type SourceOverrides = { [K in keyof Source]?: Source[K] | undefined }

export const movieSource = (id: string, overrides: SourceOverrides = {}): Source =>
  ({
    id,
    libraryId: 'lib',
    rootId: 'root',
    relativePath: `Films/${id}.mkv`,
    extension: 'mkv',
    state: 'ready',
    sizeBytes: 2_000_000_000,
    mtimeMs: 0,
    readyAt,
    discoveredAt: now,
    classification: 'movie',
    parsed: { title: id },
    matchState: 'needs_review',
    reviewReason: 'no_match',
    ...overrides,
  }) as Source

export const episodeSource = (n: number, overrides: SourceOverrides = {}): Source =>
  movieSource(`e${n}`, {
    relativePath: `Dark/Season 1/Dark S01E0${n}.mkv`,
    classification: 'episode',
    parsed: { series: 'Dark', season: 1, episode: n },
    reviewReason: 'ambiguous_match',
    ...overrides,
  })

/** A local series with one episode item per given number, each linked to the file `e<n>`. */
export const localDark = (numbers: readonly number[]) => ({
  items: [
    { id: 'l-series', kind: 'series' },
    { id: 'l-season', kind: 'season', parentId: 'l-series', seasonNumber: 1 },
    ...numbers.map((n): FakeItem => ({
      id: `l-ep${n}`,
      kind: 'episode',
      parentId: 'l-season',
      seasonNumber: 1,
      episodeNumber: n,
    })),
  ] satisfies FakeItem[],
  links: Object.fromEntries(numbers.map((n) => [`e${n}`, [`l-ep${n}`]])),
})

export type EpisodesStub = (
  seriesTmdbId: number,
  parsed: ParsedName,
  language: string,
  at?: { seasonNumber: number; episodeNumber: number },
) => Promise<Result<Resolution, TmdbError>>

type Options = {
  sources: Source[]
  libraries?: Library[]
  items?: FakeItem[]
  links?: Record<string, string[]>
  /** Episodes TMDB does not have, as `season x episode` (`1x3`). */
  missing?: string[]
  movie?: (
    tmdbId: number,
    language: string,
  ) => Promise<Result<Extract<Resolution, { kind: 'movie' }>, TmdbError>>
  episodes?: EpisodesStub
}

export const createReviewWorld = ({
  sources: initialSources,
  libraries = [library()],
  items: initialItems = [],
  links = {},
  missing = [],
  movie,
  episodes,
}: Options) => {
  const timeline: string[] = []
  const sources = new Map(initialSources.map((source) => [source.id, source]))
  const patches: { id: string; patch: SourcePatch }[] = []
  const items = createInMemoryMetadataItems(initialItems, links)
  const resolveCalls = {
    movie: [] as { tmdbId: number; language: string }[],
    episodes: [] as {
      seriesTmdbId: number
      language: string
      at?: { seasonNumber: number; episodeNumber: number }
    }[],
  }
  const applied: Parameters<ApplyMatch['apply']>[0][] = []
  const reviewed: { sourceId: string; reason: string }[] = []
  const saved: ManualMatch[] = []
  const contextChecks: { itemId: string; language: string; ratingCountry: string }[] = []
  const jobs = createRecordingJobQueue()
  const tmdb = createFakeTmdb({
    searchMovies: async () => ok([searchHit()]),
    searchSeries: async () => ok([searchHit({ tmdbId: DARK, title: 'Dark', year: 2017 })]),
  })

  const defaultEpisodes: EpisodesStub = async (seriesTmdbId, _parsed, _language, at) => {
    if (at === undefined || missing.includes(`${at.seasonNumber}x${at.episodeNumber}`)) {
      return ok({ kind: 'review', reason: 'episode_not_found' })
    }
    return ok({
      kind: 'episodes',
      series: tmdbSeries({ tmdbId: seriesTmdbId }),
      season: tmdbSeason({ seasonNumber: at.seasonNumber }),
      episodes: [tmdbEpisode(at.episodeNumber, { seasonNumber: at.seasonNumber })],
    })
  }

  const deps: Parameters<typeof searchTmdbFactory>[0] &
    Parameters<typeof assignSourceFactory>[0] &
    Parameters<typeof rejectSourceFactory>[0] &
    Parameters<typeof restoreSourceFactory>[0] &
    Parameters<typeof rematchItemFactory>[0] = {
    tmdb: tmdb.tmdb,
    resolveMatch: {
      movie: async (tmdbId, language) => {
        resolveCalls.movie.push({ tmdbId, language })
        return movie === undefined
          ? ok({ kind: 'movie', movie: tmdbMovie({ tmdbId }) })
          : movie(tmdbId, language)
      },
      episodes: async (seriesTmdbId, parsed, language, at) => {
        resolveCalls.episodes.push({ seriesTmdbId, language, ...(at === undefined ? {} : { at }) })
        return (episodes ?? defaultEpisodes)(seriesTmdbId, parsed, language, at)
      },
    },
    applyMatch: {
      apply: (input) => {
        timeline.push(`apply ${input.source.id}`)
        applied.push(input)
        return {
          itemIds: [`item-${input.source.id}`],
          enriched: ['top', `item-${input.source.id}`],
          topLevelId: 'top',
        }
      },
      review: (sourceId, reason) => {
        timeline.push(`review ${sourceId}`)
        reviewed.push({ sourceId, reason })
      },
    },
    observeLeavingFiles: (files) => {
      timeline.push(`leaving ${JSON.stringify(files)}`)
      return () => {
        timeline.push('settled')
        return 0
      }
    },
    queueRefreshIfContextDiffers: (input) => {
      contextChecks.push(input)
      return false
    },
    items: {
      ...items.repo,
      transaction: (run) => {
        timeline.push('transaction')
        return items.repo.transaction(run)
      },
    },
    sourceRepository: {
      findById: (id) => sources.get(id),
      patch: (id, patch) => {
        patches.push({ id, patch })
        const source = sources.get(id)
        if (source !== undefined) sources.set(id, { ...source, ...patch } as Source)
      },
    },
    libraryRepository: { findById: (id) => libraries.find((lib) => lib.id === id) },
    manualMatches: {
      save: (match) => void saved.push(match),
    },
    settings: { language: () => 'fr-FR' },
    jobQueue: jobs.queue,
    clock: createManualClock(now),
    logger: silentLogger,
  }

  return {
    searchTmdb: searchTmdbFactory(deps),
    assignSource: assignSourceFactory(deps),
    rejectSource: rejectSourceFactory(deps),
    restoreSource: restoreSourceFactory(deps),
    rematchItem: rematchItemFactory(deps),
    timeline,
    sources,
    patches,
    items,
    resolveCalls,
    applied,
    reviewed,
    saved,
    contextChecks,
    enqueued: jobs.enqueued,
    tmdbCalls: tmdb.calls,
  }
}

export type ReviewWorld = ReturnType<typeof createReviewWorld>

export const nothingWritten = (world: ReviewWorld) => {
  expect(world.applied).toEqual([])
  expect(world.reviewed).toEqual([])
  expect(world.saved).toEqual([])
  expect(world.patches).toEqual([])
  expect(world.enqueued).toEqual([])
  expect(world.timeline).toEqual([])
}
