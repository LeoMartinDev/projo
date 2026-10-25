import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  insertCredit,
  insertImage,
  insertItem,
  insertLibrary,
  insertProgress,
  insertSource,
  seedSeries,
  seedViewer,
} from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import {
  type CatalogRepository,
  everything,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import { toSearchExpression } from '../../core/catalog/search.ts'
import { allowedRatingsByCountry } from '../../core/profile/content-rating.ts'
import { createSqliteCatalogRepository } from './catalog-repository.ts'
import type { Db } from './database.ts'
import { createSqliteProgressRepository } from './progress-repository.ts'
import { items } from './schema/items.ts'
import { sourceSubtitles } from './schema/libraries.ts'

let db: Db
let repo: CatalogRepository

beforeEach(() => {
  db = createTestDatabase()
  repo = createSqliteCatalogRepository({ db })
  insertLibrary(db, { id: 'library-1', rootPath: '/media/fr' })
  insertLibrary(db, { id: 'library-us', rootPath: '/media/us', ratingCountry: 'US' })
})

const movie = (id: string, extra: Omit<Parameters<typeof insertItem>[1], 'id' | 'kind'> = {}) => {
  insertItem(db, { id, kind: 'movie', ...extra })
  insertSource(db, { id: `f-${id}`, itemId: id })
  return id
}

const titles = (list: { id: string }[]) => list.map((item) => item.id)

describe('§14 maximum rating', () => {
  const kids: VisibilityScope = { allowedRatings: { FR: ['TP', '10'], US: ['G', 'PG'] } }

  test('per rating country of the library; unknown rating hidden when capped', () => {
    movie('tp', { contentRating: 'TP' })
    movie('fr16', { contentRating: '16' })
    movie('unrated')
    insertItem(db, { id: 'us-pg', kind: 'movie', contentRating: 'PG' })
    insertSource(db, {
      id: 'f-us-pg',
      itemId: 'us-pg',
      libraryId: 'library-us',
      rootId: 'library-us-root',
    })
    // "PG" is not a French rating: hidden in a French library.
    movie('fr-pg', { contentRating: 'PG' })
    const list = (scope: VisibilityScope) =>
      titles(repo.listTopLevel({ kind: 'movie', sort: 'title', order: 'asc', limit: 10, scope }))
    expect(list(kids)).toEqual(['tp', 'us-pg'])
    expect(list(everything)).toHaveLength(5)
    expect(list({ allowedRatings: {} })).toEqual([])
    expect(repo.findVisible({ id: 'fr16', scope: kids })).toBeUndefined()
    expect(repo.listReadySources({ itemId: 'fr16', scope: kids })).toEqual([])
  })

  test('a rating keeps its own country: US fallback in a French library, two libraries', () => {
    movie('fallback', { contentRating: 'PG-13', contentRatingCountry: 'US' })
    movie('fallback-pg', { contentRating: 'PG', contentRatingCountry: 'US' })
    // Rated in France, also in the US library: the French scale applies to both sources.
    movie('both', { contentRating: '10', contentRatingCountry: 'FR' })
    insertSource(db, {
      id: 'f-both-us',
      itemId: 'both',
      libraryId: 'library-us',
      rootId: 'library-us-root',
    })
    const list = (scope: VisibilityScope) =>
      titles(repo.listTopLevel({ kind: 'movie', sort: 'title', order: 'asc', limit: 10, scope }))
    const sixteen: VisibilityScope = { allowedRatings: allowedRatingsByCountry('16') }
    expect(list(sixteen)).toEqual(['both', 'fallback', 'fallback-pg'])
    expect(list(kids)).toEqual(['both', 'fallback-pg'])
    expect(
      repo
        .listReadySources({ itemId: 'both', scope: kids })
        .map((source) => source.id)
        .sort(),
    ).toEqual(['f-both', 'f-both-us'])
    seedSeries(db, {
      id: 'us-show',
      episodes: [[1, 1]],
      contentRating: 'TV-14',
      contentRatingCountry: 'US',
    })
    expect(repo.findVisible({ id: 'us-show-s1e1', scope: sixteen })).toBeDefined()
    expect(repo.findVisible({ id: 'us-show-s1', scope: sixteen })).toBeDefined()
    expect(repo.findVisible({ id: 'us-show-s1e1', scope: kids })).toBeUndefined()
  })

  test('seasons and episodes follow their series; combined with library access', () => {
    seedSeries(db, { id: 'cartoon', episodes: [[1, 1]], contentRating: '10' })
    seedSeries(db, { id: 'thriller', episodes: [[1, 1]], contentRating: '16' })
    const ids = (scope: VisibilityScope) =>
      titles(repo.listTopLevel({ kind: 'series', sort: 'title', order: 'asc', limit: 10, scope }))
    expect(ids(kids)).toEqual(['cartoon'])
    expect(repo.findVisible({ id: 'thriller-s1', scope: kids })).toBeUndefined()
    expect(repo.findVisible({ id: 'thriller-s1e1', scope: kids })).toBeUndefined()
    expect(repo.findVisible({ id: 'cartoon-s1e1', scope: kids })).toBeDefined()
    expect(
      repo.listVisibleEpisodeIds({ ancestorIds: ['cartoon', 'thriller'], scope: kids }),
    ).toEqual([{ episodeId: 'cartoon-s1e1', ancestorId: 'cartoon' }])
    expect(ids({ ...kids, libraryIds: ['library-us'] })).toEqual([])
  })

  test('images exist only through a visible item or a credited person', () => {
    insertImage(db, 'poster-ok')
    insertImage(db, 'poster-16')
    insertImage(db, 'face')
    insertImage(db, 'orphan')
    movie('ok', { contentRating: 'TP', posterImageId: 'poster-ok' })
    movie('adult', { contentRating: '16', posterImageId: 'poster-16' })
    insertCredit(db, { itemId: 'adult', personId: 'actor', profileImageId: 'face' })
    const visibleImage = (imageId: string, scope: VisibilityScope) =>
      repo.isImageVisible({ imageId, scope })
    expect(visibleImage('poster-ok', kids)).toBe(true)
    expect(visibleImage('poster-16', kids)).toBe(false)
    expect(visibleImage('poster-16', everything)).toBe(true)
    expect(visibleImage('face', kids)).toBe(false)
    expect(visibleImage('face', everything)).toBe(true)
    expect(visibleImage('orphan', everything)).toBe(false)
  })
})

describe('§13.4 sorts and filters', () => {
  beforeEach(() => {
    movie('heat', {
      title: 'Heat',
      sortTitle: 'heat',
      year: 1995,
      voteAverage: 7.9,
      genres: ['action', 'crime'],
    })
    movie('alien', {
      title: 'Alien',
      sortTitle: 'alien',
      year: 1979,
      voteAverage: 8.1,
      genres: ['science_fiction', 'adventure'],
    })
    movie('casino', {
      title: 'Casino',
      sortTitle: 'casino',
      year: 1995,
      voteAverage: 7.9,
      genres: ['crime'],
    })
    movie('local', { title: 'Local', sortTitle: 'local' })
  })

  const list = (input: Partial<Parameters<CatalogRepository['listTopLevel']>[0]>) =>
    titles(
      repo.listTopLevel({
        kind: 'movie',
        sort: 'title',
        order: 'asc',
        limit: 10,
        scope: everything,
        ...input,
      }),
    )

  test('year and rating: unknown last in both directions, ties by title', () => {
    expect(list({ sort: 'year', order: 'desc' })).toEqual(['casino', 'heat', 'alien', 'local'])
    expect(list({ sort: 'year', order: 'asc' })).toEqual(['alien', 'casino', 'heat', 'local'])
    expect(list({ sort: 'rating', order: 'desc' })).toEqual(['alien', 'casino', 'heat', 'local'])
  })

  test('keyset pages on two keys', () => {
    expect(
      list({
        sort: 'year',
        order: 'desc',
        limit: 1,
        after: { keys: [1995, 'casino'], id: 'casino' },
      }),
    ).toEqual(['heat'])
    expect(
      list({ sort: 'year', order: 'desc', after: { keys: [1995, 'heat'], id: 'heat' } }),
    ).toEqual(['alien', 'local'])
    expect(
      list({ sort: 'year', order: 'desc', after: { keys: [1979, 'alien'], id: 'alien' } }),
    ).toEqual(['local'])
  })

  test('genre (an id of the JSON list), year, decade', () => {
    expect(list({ filters: { genre: 'crime' } })).toEqual(['casino', 'heat'])
    expect(list({ filters: { genre: 'adventure' } })).toEqual(['alien'])
    expect(list({ filters: { genre: 'drama' } })).toEqual([])
    expect(list({ filters: { year: 1995 } })).toEqual(['casino', 'heat'])
    expect(list({ filters: { decade: 1970 } })).toEqual(['alien'])
    expect(list({ filters: { decade: 1990, genre: 'action' } })).toEqual(['heat'])
  })

  test('genres of the visible items, deduplicated', () => {
    insertItem(db, { id: 'hidden', kind: 'movie', genres: ['western'] })
    expect([...repo.listGenres({ scope: everything })].sort()).toEqual([
      'action',
      'adventure',
      'crime',
      'science_fiction',
    ])
  })

  test('watch state of the profile: movies', () => {
    const { profileId } = seedViewer(db)
    insertProgress(db, { profileId, itemId: 'heat', watched: true })
    insertProgress(db, { profileId, itemId: 'alien', ratio: 0.5 })
    // Rewatching a watched movie: in progress wins.
    insertProgress(db, { profileId, itemId: 'casino', ratio: 0.4, watched: true })
    const watch = (state: 'watched' | 'unwatched' | 'in_progress') =>
      list({ filters: { watch: state }, profileId })
    expect(watch('watched')).toEqual(['heat'])
    expect(watch('in_progress')).toEqual(['alien', 'casino'])
    expect(watch('unwatched')).toEqual(['local'])
  })

  test('watch state of the profile: series from their visible episodes', () => {
    const { profileId } = seedViewer(db)
    seedSeries(db, {
      id: 'done',
      episodes: [
        [1, 1],
        [1, 2],
      ],
    })
    seedSeries(db, {
      id: 'half',
      episodes: [
        [1, 1],
        [1, 2],
      ],
    })
    seedSeries(db, { id: 'fresh', episodes: [[1, 1]] })
    seedSeries(db, { id: 'playing', episodes: [[1, 1]] })
    for (const id of ['done-s1e1', 'done-s1e2', 'half-s1e1']) {
      insertProgress(db, { profileId, itemId: id, watched: true })
    }
    insertProgress(db, { profileId, itemId: 'playing-s1e1', ratio: 0.5 })
    // A hidden episode (pending file) does not count.
    insertItem(db, {
      id: 'done-s1e3',
      kind: 'episode',
      parentId: 'done-s1',
      seasonNumber: 1,
      episodeNumber: 3,
    })
    const watch = (state: 'watched' | 'unwatched' | 'in_progress') =>
      list({ kind: 'series', filters: { watch: state }, profileId })
    expect(watch('watched')).toEqual(['done'])
    expect(watch('in_progress')).toEqual(['half', 'playing'])
    expect(watch('unwatched')).toEqual(['fresh'])
  })
})

describe('§13.5 search (FTS5)', () => {
  beforeEach(() => {
    movie('amelie', { title: "Le Fabuleux Destin d'Amélie Poulain", originalTitle: 'Amélie' })
    movie('amer', { title: 'Amer' })
    seedSeries(db, { id: 'oedipe', title: 'Œdipe roi', episodes: [[1, 1]] })
    insertItem(db, { id: 'pending', kind: 'movie', title: 'Amélie bis' })
  })

  const search = (query: string, scope: VisibilityScope = everything) =>
    titles(repo.search({ expression: toSearchExpression(query) ?? '', limit: 30, scope }))

  test('accent and case insensitive, word prefixes, title or original title', () => {
    expect(search('AMEL')).toEqual(['amelie'])
    expect(search('ame')).toEqual(expect.arrayContaining(['amelie', 'amer']))
    expect(search('destin poul')).toEqual(['amelie'])
    expect(search('œdipe')).toEqual(['oedipe'])
  })

  test('only visible movies and series; follows title updates and deletions', () => {
    expect(search('bis')).toEqual([])
    db.update(items).set({ title: 'Zodiac' }).where(eq(items.id, 'amer')).run()
    expect(search('zodi')).toEqual(['amer'])
    expect(search('amer')).toEqual([])
    db.delete(items).where(eq(items.id, 'amelie')).run()
    expect(search('amelie')).toEqual([])
  })

  test('episodes and seasons are not indexed; scope applies', () => {
    db.update(items).set({ title: 'Amélie episode' }).where(eq(items.id, 'oedipe-s1e1')).run()
    expect(search('amélie')).toEqual(['amelie'])
    expect(search('ame', { libraryIds: [] })).toEqual([])
  })
})

describe('§13.3 a series rises with a new episode', () => {
  test('an episode becoming ready raises its season and series', () => {
    seedSeries(db, { id: 'show', episodes: [[1, 1]], addedAt: '2026-01-01T00:00:00.000Z' })
    movie('film', { addedAt: '2026-01-05T00:00:00.000Z' })
    expect(titles(repo.listRecentlyAdded({ limit: 10, scope: everything }))).toEqual([
      'film',
      'show',
    ])
    insertItem(db, {
      id: 'show-s1e2',
      kind: 'episode',
      parentId: 'show-s1',
      seasonNumber: 1,
      episodeNumber: 2,
    })
    insertSource(db, { id: 'f-show-s1e2', itemId: 'show-s1e2' })
    db.update(items)
      .set({ addedAt: '2026-01-09T00:00:00.000Z' })
      .where(eq(items.id, 'show-s1e2'))
      .run()
    expect(titles(repo.listRecentlyAdded({ limit: 10, scope: everything }))).toEqual([
      'show',
      'film',
    ])
    expect(repo.findVisible({ id: 'show-s1', scope: everything })?.addedAt?.toISOString()).toBe(
      '2026-01-09T00:00:00.000Z',
    )
  })
})

describe('§13.5 item details', () => {
  test('cast and crew, by role then order', () => {
    movie('m')
    insertCredit(db, { itemId: 'm', personId: 'dir', role: 'director', order: 0 })
    insertCredit(db, { itemId: 'm', personId: 'b', character: 'Bob', order: 1 })
    insertCredit(db, { itemId: 'm', personId: 'a', character: 'Ann', order: 0 })
    expect(repo.listPeople('m').map((person) => [person.id, person.role])).toEqual([
      ['a', 'cast'],
      ['b', 'cast'],
      ['dir', 'director'],
    ])
  })

  test('best quality and languages of a series, from every visible episode', () => {
    seedSeries(db, {
      id: 'show',
      episodes: [
        [1, 1],
        [1, 2],
      ],
    })
    const probe = (width: number, transfer: string, audio: string, subtitle: string) => ({
      streams: [
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'hevc',
          width,
          height: width / 2,
          color_transfer: transfer,
        },
        { index: 1, codec_type: 'audio', codec_name: 'aac', tags: { language: audio } },
        { index: 2, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: subtitle } },
      ],
    })
    insertSource(db, {
      id: 'uhd',
      itemId: 'show-s1e2',
      probe: probe(3840, 'smpte2084', 'eng', 'fre'),
    })
    insertSource(db, { id: 'hd', itemId: 'show-s1e1', probe: probe(1920, 'bt709', 'fre', 'eng') })
    db.insert(sourceSubtitles)
      .values({ id: 'ext', sourceId: 'hd', kind: 'external', language: 'de', format: 'srt' })
      .run()
    const summary = repo.describeMedia({ itemId: 'show', scope: everything })
    expect(summary.bestQuality).toEqual({ resolution: '2160p', dynamicRange: 'hdr' })
    expect([...summary.audioLanguages].sort()).toEqual(['eng', 'fre'])
    expect([...summary.subtitleLanguages].sort()).toEqual(['de', 'eng', 'fre'])
    expect(repo.describeMedia({ itemId: 'show', scope: { libraryIds: [] } })).toEqual({
      audioLanguages: [],
      subtitleLanguages: [],
    })
  })

  test('episodes of series in broadcast order', () => {
    seedSeries(db, {
      id: 'show',
      episodes: [
        [2, 1],
        [1, 2],
        [1, 1],
      ],
    })
    expect(repo.listSeriesEpisodes({ seriesIds: ['show'], scope: everything })).toEqual([
      { id: 'show-s1e1', seriesId: 'show', seasonNumber: 1, episodeNumber: 1 },
      { id: 'show-s1e2', seriesId: 'show', seasonNumber: 1, episodeNumber: 2 },
      { id: 'show-s2e1', seriesId: 'show', seasonNumber: 2, episodeNumber: 1 },
    ])
  })
})

describe('progress queries', () => {
  test('played movies and episodes of a profile, with the series, within the scope', () => {
    const { profileId } = seedViewer(db)
    movie('m', { contentRating: '16' })
    seedSeries(db, { id: 'show', episodes: [[1, 1]], contentRating: 'TP' })
    insertProgress(db, { profileId, itemId: 'm', ratio: 0.5 })
    insertProgress(db, { profileId, itemId: 'show-s1e1', watched: true })
    insertProgress(db, { profileId, itemId: 'show', hidden: true })
    const progress = createSqliteProgressRepository({ db })
    const played = (scope: VisibilityScope) =>
      progress
        .listPlayed({ profileId, scope })
        .map((entry) => [entry.itemId, entry.kind, entry.seriesId])
        .sort()
    expect(played(everything)).toEqual([
      ['m', 'movie', undefined],
      ['show-s1e1', 'episode', 'show'],
    ])
    expect(played({ allowedRatings: { FR: ['TP'] } })).toEqual([['show-s1e1', 'episode', 'show']])
    progress.showAncestorsAgain({ profileId, itemId: 'show-s1e1' })
    expect(progress.find({ profileId, itemId: 'show' })?.hiddenFromContinue).toBe(false)
  })
})
