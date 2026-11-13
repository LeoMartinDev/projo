import { appError, err, ok } from '@projo/shared'

import type {
  LockableField,
  MetadataPatch,
  PersonCredit,
} from '../../src/core/metadata/enrichment.ts'
import type { LinkedItemInfo } from '../../src/core/metadata/linking.ts'
import type { MetadataItemRepository, NewMetadataItem } from '../../src/core/metadata/ports.ts'
import type {
  TmdbApi,
  TmdbEpisode,
  TmdbError,
  TmdbMovie,
  TmdbSearchHit,
  TmdbSeason,
  TmdbSeries,
} from '../../src/core/metadata/tmdb.ts'

export const tmdbFailure = (code: TmdbError['code'] = 'metadata/tmdb_unavailable') =>
  err(appError(code, `TMDB failure: ${code}`))

export const tmdbMovie = (overrides: Partial<TmdbMovie> = {}): TmdbMovie => ({
  tmdbId: 27205,
  title: 'Inception',
  originalTitle: 'Inception',
  overview: 'A thief who steals corporate secrets.',
  genres: ['action'],
  originalLanguage: 'en',
  releaseDate: '2010-07-15',
  images: { posters: [], backdrops: [], logos: [] },
  credits: { cast: [], crew: [] },
  ratings: [],
  ...overrides,
})

export const tmdbSeries = (overrides: Partial<TmdbSeries> = {}): TmdbSeries => ({
  tmdbId: 70523,
  title: 'Dark',
  originalTitle: 'Dark',
  overview: 'A missing child sets four families on a frantic hunt.',
  genres: ['drama'],
  originalLanguage: 'de',
  firstAirDate: '2017-12-01',
  images: { posters: [], backdrops: [], logos: [] },
  credits: { cast: [], crew: [] },
  ratings: [],
  seasons: [{ seasonNumber: 1, episodeCount: 10 }],
  createdBy: [],
  ...overrides,
})

export const tmdbEpisode = (
  episodeNumber: number,
  overrides: Partial<TmdbEpisode> = {},
): TmdbEpisode => ({
  tmdbId: 1000 + episodeNumber,
  seasonNumber: 1,
  episodeNumber,
  name: `Episode title ${episodeNumber}`,
  overview: `Overview ${episodeNumber}`,
  ...overrides,
})

export const tmdbSeason = (overrides: Partial<TmdbSeason> = {}): TmdbSeason => ({
  tmdbId: 900,
  seasonNumber: 1,
  name: 'Season 1',
  overview: 'The first season.',
  episodes: [tmdbEpisode(1), tmdbEpisode(2), tmdbEpisode(3)],
  ...overrides,
})

export const searchHit = (overrides: Partial<TmdbSearchHit> = {}): TmdbSearchHit => ({
  tmdbId: 27205,
  title: 'Inception',
  year: 2010,
  popularity: 50,
  voteCount: 30_000,
  ...overrides,
})

type TmdbCall = {
  [K in keyof TmdbApi]: { method: K; input: Parameters<TmdbApi[K]>[0] }
}[keyof TmdbApi]

/** A TmdbApi answering "not found" (or nothing) by default; each test overrides what it needs. */
export const createFakeTmdb = (overrides: Partial<TmdbApi> = {}) => {
  const calls: TmdbCall[] = []
  const notFound = async () => tmdbFailure('metadata/tmdb_not_found')
  const api: TmdbApi = {
    searchMovies: async () => ok([]),
    searchSeries: async () => ok([]),
    find: async () => ok({ movieIds: [], seriesIds: [] }),
    alternativeTitles: async () => ok([]),
    movie: notFound,
    series: notFound,
    season: notFound,
    images: async () => ok({ posters: [], backdrops: [], logos: [] }),
    validateKey: async () => ok(undefined),
    downloadImage: notFound,
    ...overrides,
  }
  const recorded = <K extends keyof TmdbApi>(method: K): TmdbApi[K] =>
    ((input: Parameters<TmdbApi[K]>[0]) => {
      calls.push({ method, input } as TmdbCall)
      return (api[method] as (value: typeof input) => ReturnType<TmdbApi[K]>)(input)
    }) as TmdbApi[K]
  const tmdb: TmdbApi = {
    searchMovies: recorded('searchMovies'),
    searchSeries: recorded('searchSeries'),
    find: recorded('find'),
    alternativeTitles: recorded('alternativeTitles'),
    movie: recorded('movie'),
    series: recorded('series'),
    season: recorded('season'),
    images: recorded('images'),
    validateKey: recorded('validateKey'),
    downloadImage: recorded('downloadImage'),
  }
  const callsTo = <K extends keyof TmdbApi>(method: K): Parameters<TmdbApi[K]>[0][] =>
    calls.flatMap((call) =>
      call.method === method ? [call.input as Parameters<TmdbApi[K]>[0]] : [],
    )
  return { tmdb, calls, callsTo }
}

export type FakeItem = LinkedItemInfo & { title?: string; sortTitle?: string; createdAt?: Date }

/** SQLite ascending order: an absent value (NULL) sorts first. */
const ascending = (a: number | string | undefined, b: number | string | undefined): number => {
  if (a === b) return 0
  if (a === undefined) return -1
  if (b === undefined) return 1
  return a < b ? -1 : 1
}

const byCreation = (a: FakeItem, b: FakeItem) =>
  ascending(a.createdAt?.getTime() ?? 0, b.createdAt?.getTime() ?? 0) || ascending(a.id, b.id)

/**
 * In-memory MetadataItemRepository: items, source links and the writes made to them.
 * Filters and orders follow the SQLite adapter: `linkedItems` by episode number then id,
 * `sourcesUnder` one row per source (its lowest season and episode under the item, two levels
 * deep), ordered by source id; `findByTmdb` top-level items only and `findChild` the oldest
 * match; `pruneOrphans` only local items without file nor child, then their parents, level
 * by level.
 */
export const createInMemoryMetadataItems = (
  initial: readonly FakeItem[] = [],
  initialLinks: Readonly<Record<string, readonly string[]>> = {},
) => {
  const items = new Map(initial.map((item) => [item.id, { ...item }]))
  const links = new Map(Object.entries(initialLinks).map(([id, ids]) => [id, [...ids]]))
  const locked = new Map<string, Set<LockableField>>()
  const log = {
    transactions: 0,
    created: [] as NewMetadataItem[],
    tmdbIdsSet: [] as { id: string; tmdbId: number }[],
    written: [] as { id: string; patch: MetadataPatch; language: string; refreshedAt: Date }[],
    people: [] as { itemId: string; people: PersonCredit[] }[],
    moved: [] as { from: string; into: string }[],
    markedAdded: [] as { itemIds: string[]; at: Date }[],
    pruned: [] as string[],
  }

  const info = (item: FakeItem): LinkedItemInfo => {
    const { title: _title, sortTitle: _sortTitle, createdAt: _createdAt, ...rest } = item
    return rest
  }
  const childrenOf = (id: string) => [...items.values()].filter((item) => item.parentId === id)
  const twoLevelsUnder = (id: string): Set<string> => {
    const children = childrenOf(id).map((child) => child.id)
    return new Set([
      id,
      ...children,
      ...children.flatMap((child) => childrenOf(child).map((c) => c.id)),
    ])
  }
  const sourcesUnder = (itemId: string) => {
    const within = twoLevelsUnder(itemId)
    return [...links.keys()].sort(ascending).flatMap((sourceId) => {
      const [first] = (links.get(sourceId) ?? [])
        .flatMap((id) => {
          const item = items.get(id)
          return item !== undefined && within.has(id) ? [item] : []
        })
        .sort(
          (a, b) =>
            ascending(a.seasonNumber, b.seasonNumber) ||
            ascending(a.episodeNumber, b.episodeNumber),
        )
      if (first === undefined) return []
      return [
        {
          sourceId,
          ...(first.seasonNumber === undefined ? {} : { seasonNumber: first.seasonNumber }),
          ...(first.episodeNumber === undefined ? {} : { episodeNumber: first.episodeNumber }),
        },
      ]
    })
  }
  const linked = (id: string) => [...links.values()].some((ids) => ids.includes(id))

  const repo: MetadataItemRepository = {
    transaction: (run) => {
      log.transactions += 1
      return run()
    },
    findItem: (id) => {
      const item = items.get(id)
      return item && info(item)
    },
    linkedItems: (sourceId) =>
      (links.get(sourceId) ?? [])
        .flatMap((id) => {
          const item = items.get(id)
          return item === undefined ? [] : [item]
        })
        .sort((a, b) => ascending(a.episodeNumber, b.episodeNumber) || ascending(a.id, b.id))
        .map(info),
    findByTmdb: ({ kind, tmdbId }) =>
      [...items.values()]
        .filter(
          (item) => item.kind === kind && item.tmdbId === tmdbId && item.parentId === undefined,
        )
        .sort(byCreation)[0]?.id,
    findChild: ({ parentId, kind, number }) =>
      [...items.values()]
        .filter(
          (item) =>
            item.parentId === parentId &&
            item.kind === kind &&
            (kind === 'season' ? item.seasonNumber : item.episodeNumber) === number,
        )
        .sort(byCreation)[0]?.id,
    create: (item) => {
      log.created.push(item)
      items.set(item.id, { ...item })
    },
    setTmdbId: ({ id, tmdbId }) => {
      log.tmdbIdsSet.push({ id, tmdbId })
      const item = items.get(id)
      if (item !== undefined) items.set(id, { ...item, tmdbId })
    },
    lockedFields: (id) => locked.get(id) ?? new Set(),
    writeMetadata: (input) => {
      log.written.push(input)
    },
    replacePeople: ({ itemId, people }) => {
      log.people.push({ itemId, people })
    },
    moveItemRows: (pair) => {
      log.moved.push(pair)
    },
    replaceLinks: ({ sourceId, itemIds }) => {
      links.set(sourceId, [...itemIds])
    },
    markAdded: (input) => {
      log.markedAdded.push(input)
    },
    pruneOrphans: (itemIds, beforeDelete) => {
      let level = [...new Set(itemIds)]
      while (level.length > 0) {
        const parents = level.flatMap((id) => {
          const parentId = items.get(id)?.parentId
          return parentId === undefined ? [] : [parentId]
        })
        const removable = level.filter((id) => {
          const item = items.get(id)
          return (
            item !== undefined &&
            item.tmdbId === undefined &&
            !linked(id) &&
            childrenOf(id).length === 0
          )
        })
        if (removable.length === 0) return
        beforeDelete(removable)
        for (const id of removable) items.delete(id)
        log.pruned.push(...removable)
        level = [...new Set(parents)]
      }
    },
    sourcesUnder,
    sourcesAwaitingMatch: () => [],
    imageContext: () => undefined,
    peopleOf: () => [],
  }
  return { repo, items, links, locked, log }
}

export type InMemoryMetadataItems = ReturnType<typeof createInMemoryMetadataItems>
