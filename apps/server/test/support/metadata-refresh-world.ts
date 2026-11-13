import { ok } from '@projo/shared'

import { observeLeavingFilesFactory } from '../../src/application/metadata/observe-leaving-files.ts'
import { queueLibraryContextRefreshFactory } from '../../src/application/metadata/queue-library-context-refresh.ts'
import { queueRefreshIfContextDiffersFactory } from '../../src/application/metadata/queue-refresh-if-context-differs.ts'
import { queueStaleLanguageRefreshFactory } from '../../src/application/metadata/queue-stale-language-refresh.ts'
import { refreshItemMetadataFactory } from '../../src/application/metadata/refresh-item-metadata.ts'
import { LIBRARY_REFRESH_PRIORITY } from '../../src/application/metadata/shared/refresh-jobs.ts'
import type { TmdbDetails } from '../../src/application/metadata/shared/tmdb-details.ts'
import type { MetadataRefreshRepository } from '../../src/core/metadata/editing.ts'
import type { LinkedItemInfo } from '../../src/core/metadata/linking.ts'
import type { MetadataItemRepository } from '../../src/core/metadata/ports.ts'
import type { TmdbMovie } from '../../src/core/metadata/tmdb.ts'
import { createManualClock } from './clock.ts'
import { createRecordingJobQueue, createSequentialIds } from './fakes.ts'
import { silentLogger } from './logger.ts'

const inception: TmdbMovie = {
  tmdbId: 27205,
  title: 'Inception',
  originalTitle: 'Inception',
  overview: 'Dom Cobb…',
  genres: ['action'],
  images: { posters: [], backdrops: [], logos: [] },
  credits: { cast: [], crew: [] },
  ratings: [
    { country: 'US', rating: 'PG-13', type: 3 },
    { country: 'FR', rating: 'TP', type: 3 },
  ],
}

/*
 * In-memory fakes of the metadata refresh use cases, for their unit tests. `metadata-world.ts`
 * is the real one: modules, SQLite and the replayed TMDB server.
 */

/** The `refresh_metadata` job a library-wide change queues for one item. */
export const lowPriorityRefresh = (itemId: string) => ({
  payload: { itemId },
  dedupeKey: `refresh:${itemId}`,
  priority: LIBRARY_REFRESH_PRIORITY,
})

type Library = { ratingCountry: string; language?: string }

type Tree = { ratingCountry: string; stale: boolean }

/** The metadata refresh use cases over one movie, in-memory deciding libraries and trees. */
export const createMetadataRefreshWorld = ({
  libraries = {},
  serverLanguage = 'fr-FR',
  stale = {},
  decided = {},
  trees = {},
  withFiles = [],
}: {
  libraries?: Record<string, Library>
  serverLanguage?: string
  stale?: Record<string, string[]>
  decided?: Record<string, string[]>
  trees?: Record<string, Tree>
  withFiles?: string[]
} = {}) => {
  const movie: LinkedItemInfo = { id: 'movie', kind: 'movie', tmdbId: 27205 }
  const writes: { id: string; language: string; contentRatingCountry?: string }[] = []
  const staleCalls: { serverLanguage: string; libraryId?: string }[] = []
  const languages: string[] = []
  const items: Pick<
    MetadataItemRepository,
    'transaction' | 'findItem' | 'lockedFields' | 'writeMetadata' | 'replacePeople'
  > = {
    transaction: (run) => run(),
    findItem: (id) => (id === movie.id ? movie : undefined),
    lockedFields: () => new Set(),
    writeMetadata: ({ id, patch, language }) =>
      void writes.push({
        id,
        language,
        ...(patch.contentRatingCountry === undefined
          ? {}
          : { contentRatingCountry: patch.contentRatingCountry }),
      }),
    replacePeople: () => {},
  }
  const refreshRepository: MetadataRefreshRepository = {
    children: () => [],
    libraryOf: (itemId) => libraries[itemId],
    identifiedTopLevel: () => [],
    inProductionSeriesRefreshedBefore: () => [],
    staleLanguage: (input) => {
      staleCalls.push(input)
      return stale[input.libraryId ?? ''] ?? []
    },
    decidedBy: (libraryId) => decided[libraryId] ?? [],
    treeStates: ({ topIds }) =>
      topIds.flatMap((topId) => {
        const tree = trees[topId]
        return tree === undefined ? [] : [{ topId, ...tree }]
      }),
    topLevelWithFiles: () => withFiles,
  }
  const details = {
    movie: async ({ language }: { language: string }) => {
      languages.push(language)
      return ok(inception)
    },
  } as unknown as TmdbDetails
  const { queue, enqueued } = createRecordingJobQueue()
  const deps = {
    details,
    items,
    refreshRepository,
    settings: { language: () => serverLanguage },
    jobQueue: queue,
    ids: createSequentialIds(),
    clock: createManualClock(),
    logger: silentLogger,
  }
  const refreshes = () =>
    enqueued
      .filter((job) => job.type === 'refresh_metadata')
      .map((job) => ({ payload: job.payload, dedupeKey: job.dedupeKey, priority: job.priority }))
  return {
    refreshItemMetadata: refreshItemMetadataFactory(deps),
    queueStaleLanguageRefresh: queueStaleLanguageRefreshFactory(deps),
    queueLibraryContextRefresh: queueLibraryContextRefreshFactory(deps),
    queueRefreshIfContextDiffers: queueRefreshIfContextDiffersFactory(deps),
    observeLeavingFiles: observeLeavingFilesFactory(deps),
    writes,
    languages,
    staleCalls,
    refreshes,
    trees,
  }
}
