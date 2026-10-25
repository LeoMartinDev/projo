import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import type { LinkedItemInfo } from '../../core/metadata/linking.ts'
import type { MetadataItemRepository } from '../../core/metadata/ports.ts'
import type { TmdbMovie } from '../../core/metadata/tmdb.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingJobQueue, createSequentialIds } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { LIBRARY_REFRESH_PRIORITY, refreshMetadataFactory } from './refresh-metadata.ts'
import type { TmdbDetails } from './tmdb-details.ts'

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

type Library = { ratingCountry: string; language?: string }

type Tree = { ratingCountry: string; stale: boolean }

/**
 * `libraries`: the deciding library of each item (absent: no file). `stale`: what
 * `staleLanguage` answers per library id ('' = every library), `decided`: `decidedBy`.
 * `trees`: what `treeStates` answers (mutable: files leaving), `withFiles`: `topLevelWithFiles`.
 */
const setup = ({
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
  const refresh = refreshMetadataFactory({
    details,
    items,
    refreshRepository,
    settings: { language: () => serverLanguage },
    jobQueue: queue,
    ids: createSequentialIds(),
    clock: createManualClock(),
    logger: silentLogger,
  })
  const refreshes = () =>
    enqueued
      .filter((job) => job.type === 'refresh_metadata')
      .map((job) => ({ payload: job.payload, dedupeKey: job.dedupeKey, priority: job.priority }))
  return { refresh, writes, languages, staleCalls, refreshes, trees }
}

describe('metadata language of a refresh (§9.1)', () => {
  test('fetched and recorded in the language of the deciding library', async () => {
    const world = setup({ libraries: { movie: { ratingCountry: 'FR', language: 'en-US' } } })
    expect(await world.refresh.refreshItem({ itemId: 'movie' })).toEqual(
      ok({ refreshed: ['movie'] }),
    )
    expect(world.languages).toEqual(['en-US'])
    expect(world.writes).toEqual([{ id: 'movie', language: 'en-US', contentRatingCountry: 'FR' }])
  })

  test('the server language when the deciding library has none', async () => {
    const world = setup({
      libraries: { movie: { ratingCountry: 'US' } },
      serverLanguage: 'de-DE',
    })
    await world.refresh.refreshItem({ itemId: 'movie' })
    expect(world.writes).toEqual([{ id: 'movie', language: 'de-DE', contentRatingCountry: 'US' }])
  })
})

describe('refresh queued on a change of language or rating country (§9.4)', () => {
  const low = (itemId: string) => ({
    payload: { itemId },
    dedupeKey: `refresh:${itemId}`,
    priority: LIBRARY_REFRESH_PRIORITY,
  })

  test('server language: every stale movie or series, low priority, deduplicated by item', () => {
    const world = setup({ serverLanguage: 'en-US', stale: { '': ['movie', 'series'] } })
    expect(world.refresh.queueStaleLanguage()).toBe(2)
    expect(world.staleCalls).toEqual([{ serverLanguage: 'en-US' }])
    expect(world.refreshes()).toEqual([low('movie'), low('series')])
  })

  test('library: its stale trees for a language, the trees it decides for a country', () => {
    const stale = { lib: ['b', 'a'] }
    const decided = { lib: ['a', 'c'] }
    const language = setup({ stale, decided })
    expect(
      language.refresh.queueLibraryContextChange({
        libraryId: 'lib',
        language: true,
        ratingCountry: false,
      }),
    ).toBe(2)
    expect(language.staleCalls).toEqual([{ serverLanguage: 'fr-FR', libraryId: 'lib' }])
    expect(language.refreshes()).toEqual([low('a'), low('b')])

    const country = setup({ stale, decided })
    country.refresh.queueLibraryContextChange({
      libraryId: 'lib',
      language: false,
      ratingCountry: true,
    })
    expect(country.staleCalls).toEqual([])
    expect(country.refreshes()).toEqual([low('a'), low('c')])

    const both = setup({ stale, decided })
    expect(
      both.refresh.queueLibraryContextChange({
        libraryId: 'lib',
        language: true,
        ratingCountry: true,
      }),
    ).toBe(3)
    expect(both.refreshes()).toEqual([low('a'), low('b'), low('c')])
  })

  test('after an identification: refreshed only when the deciding library differs', () => {
    const world = setup({
      libraries: { series: { ratingCountry: 'FR' }, movie: { ratingCountry: 'FR' } },
    })
    // Written with the settings the tree resolves to: nothing to do.
    expect(
      world.refresh.queueIfContextDiffers({
        itemId: 'series',
        language: 'fr-FR',
        ratingCountry: 'FR',
      }),
    ).toBe(false)
    // A file of a newer library in English, or in another country: the whole tree again.
    expect(
      world.refresh.queueIfContextDiffers({
        itemId: 'series',
        language: 'en-US',
        ratingCountry: 'FR',
      }),
    ).toBe(true)
    expect(
      world.refresh.queueIfContextDiffers({
        itemId: 'movie',
        language: 'fr-FR',
        ratingCountry: 'US',
      }),
    ).toBe(true)
    expect(world.refreshes()).toEqual([low('series'), low('movie')])
  })

  test('after an identification in the deciding settings: refreshed when the tree is stale', () => {
    const world = setup({
      libraries: { series: { ratingCountry: 'FR' }, other: { ratingCountry: 'FR' } },
      trees: {
        series: { ratingCountry: 'FR', stale: true },
        other: { ratingCountry: 'FR', stale: false },
      },
    })
    const written = { language: 'fr-FR', ratingCountry: 'FR' }
    expect(world.refresh.queueIfContextDiffers({ itemId: 'series', ...written })).toBe(true)
    expect(world.refresh.queueIfContextDiffers({ itemId: 'other', ...written })).toBe(false)
    expect(world.refreshes()).toEqual([low('series')])
  })

  test('files leaving: the trees whose deciding country changed or that became stale', () => {
    const world = setup({
      withFiles: ['a', 'b', 'c', 'gone'],
      trees: {
        a: { ratingCountry: 'FR', stale: false },
        b: { ratingCountry: 'FR', stale: false },
        c: { ratingCountry: 'FR', stale: false },
        gone: { ratingCountry: 'FR', stale: false },
      },
    })
    const settle = world.refresh.filesLeaving({ libraryId: 'kids' })
    world.trees['a'] = { ratingCountry: 'US', stale: false }
    world.trees['b'] = { ratingCountry: 'FR', stale: true }
    delete world.trees['gone']
    expect(settle()).toBe(2)
    expect(world.refreshes()).toEqual([low('a'), low('b')])
  })

  test('files leaving: nothing held, nothing looked at again', () => {
    const world = setup({ trees: { a: { ratingCountry: 'US', stale: true } } })
    expect(world.refresh.filesLeaving({ sourceIds: ['s'] })()).toBe(0)
    expect(world.refreshes()).toEqual([])
  })
})
