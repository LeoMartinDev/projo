import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { insertItem, insertLibrary, insertSource } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { type CatalogRepository, everything } from '../../core/catalog/catalog.ts'
import { createSqliteCatalogRepository } from './catalog-repository.ts'
import type { Db } from './database.ts'
import { sources } from './schema/libraries.ts'

let db: Db
let repo: CatalogRepository

const movie = (id: string, extra: Omit<Parameters<typeof insertItem>[1], 'id' | 'kind'> = {}) =>
  insertItem(db, { id, kind: 'movie', ...extra })

beforeEach(() => {
  db = createTestDatabase()
  repo = createSqliteCatalogRepository({ db })
  insertLibrary(db, { id: 'library-1', rootPath: '/media/films/' })
  insertLibrary(db, { id: 'library-2', rootPath: '/media/kids' })
})

/** Series → 2 seasons; season 1 has a ready and a pending episode, season 2 only pending ones. */
const seedSeries = () => {
  insertItem(db, { id: 'series', kind: 'series', title: 'Show', sortTitle: 'show' })
  insertItem(db, { id: 's1', kind: 'season', parentId: 'series', seasonNumber: 1 })
  insertItem(db, { id: 's2', kind: 'season', parentId: 'series', seasonNumber: 2 })
  insertItem(db, { id: 's1e2', kind: 'episode', parentId: 's1', seasonNumber: 1, episodeNumber: 2 })
  insertItem(db, { id: 's1e1', kind: 'episode', parentId: 's1', seasonNumber: 1, episodeNumber: 1 })
  insertItem(db, { id: 's1e3', kind: 'episode', parentId: 's1', seasonNumber: 1, episodeNumber: 3 })
  insertItem(db, { id: 's2e1', kind: 'episode', parentId: 's2', seasonNumber: 2, episodeNumber: 1 })
  insertSource(db, { id: 'f-s1e1', itemId: 's1e1' })
  insertSource(db, { id: 'f-s1e2', itemId: 's1e2' })
  insertSource(db, { id: 'f-s1e3', itemId: 's1e3', state: 'pending' })
  insertSource(db, { id: 'f-s2e1', itemId: 's2e1', state: 'missing' })
}

describe('§6.3 visibility', () => {
  test('a movie is visible with a ready source only', () => {
    movie('ready')
    movie('pending')
    movie('none')
    insertSource(db, { id: 'a', itemId: 'ready' })
    insertSource(db, { id: 'b', itemId: 'pending', state: 'pending' })
    insertSource(db, { id: 'c', itemId: 'pending', state: 'missing' })
    expect(
      repo
        .listTopLevel({ kind: 'movie', sort: 'title', order: 'asc', limit: 10, scope: everything })
        .map((item) => item.id),
    ).toEqual(['ready'])
    expect(repo.findVisible({ id: 'pending', scope: everything })).toBeUndefined()
    expect(repo.findVisible({ id: 'ready', scope: everything })?.kind).toBe('movie')
  })

  test('seasons and series are visible through their episodes', () => {
    seedSeries()
    expect(repo.findVisible({ id: 'series', scope: everything })).toBeDefined()
    expect(repo.findVisible({ id: 's1', scope: everything })).toBeDefined()
    expect(repo.findVisible({ id: 's2', scope: everything })).toBeUndefined()
    expect(repo.findVisible({ id: 's1e3', scope: everything })).toBeUndefined()
    expect(
      repo.listVisibleChildren({ parentId: 'series', scope: everything }).map((i) => i.id),
    ).toEqual(['s1'])
    expect(
      repo.listVisibleChildren({ parentId: 's1', scope: everything }).map((i) => i.id),
    ).toEqual(['s1e1', 's1e2'])
  })

  test('a series without any ready episode does not exist', () => {
    insertItem(db, { id: 'empty', kind: 'series' })
    insertItem(db, { id: 'empty-s1', kind: 'season', parentId: 'empty' })
    expect(
      repo.listTopLevel({
        kind: 'series',
        sort: 'title',
        order: 'asc',
        limit: 10,
        scope: everything,
      }),
    ).toEqual([])
  })

  test('scope by library (M2 profile access)', () => {
    movie('adult')
    movie('kid')
    insertSource(db, { id: 'a', itemId: 'adult' })
    insertSource(db, { id: 'k', itemId: 'kid', libraryId: 'library-2', rootId: 'library-2-root' })
    const ids = (libraryIds: string[]) =>
      repo
        .listTopLevel({
          kind: 'movie',
          sort: 'title',
          order: 'asc',
          limit: 10,
          scope: { libraryIds },
        })
        .map((item) => item.id)
    expect(ids(['library-2'])).toEqual(['kid'])
    expect(ids([])).toEqual([])
    expect(
      repo.listReadySources({ itemId: 'adult', scope: { libraryIds: ['library-2'] } }),
    ).toEqual([])
  })

  test('visible episode ids of seasons and series', () => {
    seedSeries()
    const sorted = (rows: { episodeId: string; ancestorId: string }[]) =>
      [...rows].sort((a, b) =>
        `${a.episodeId}/${a.ancestorId}`.localeCompare(`${b.episodeId}/${b.ancestorId}`),
      )
    expect(
      sorted(repo.listVisibleEpisodeIds({ ancestorIds: ['series', 's1'], scope: everything })),
    ).toEqual([
      { episodeId: 's1e1', ancestorId: 's1' },
      { episodeId: 's1e1', ancestorId: 'series' },
      { episodeId: 's1e2', ancestorId: 's1' },
      { episodeId: 's1e2', ancestorId: 'series' },
    ])
    expect(repo.listVisibleEpisodeIds({ ancestorIds: [], scope: everything })).toEqual([])
  })
})

describe('keyset pagination', () => {
  beforeEach(() => {
    const titles = ['b', 'A', 'c', 'D', 'e']
    titles.forEach((title, i) => {
      movie(`m${i}`, {
        title,
        sortTitle: title,
        addedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
      })
      insertSource(db, { id: `f${i}`, itemId: `m${i}` })
    })
  })

  const page = (input: Partial<Parameters<CatalogRepository['listTopLevel']>[0]>) =>
    repo
      .listTopLevel({
        kind: 'movie',
        sort: 'title',
        order: 'asc',
        limit: 2,
        scope: everything,
        ...input,
      })
      .map((item) => item.title)

  test('by title, case-insensitive', () => {
    expect(page({})).toEqual(['A', 'b'])
    expect(page({ after: { keys: ['b'], id: 'm0' } })).toEqual(['c', 'D'])
    expect(page({ after: { keys: ['D'], id: 'm3' } })).toEqual(['e'])
    expect(page({ order: 'desc', limit: 10 })).toEqual(['e', 'D', 'c', 'b', 'A'])
  })

  test('by addition date, newest first; equal keys broken by id', () => {
    expect(page({ sort: 'added', order: 'desc' })).toEqual(['e', 'D'])
    expect(
      page({
        sort: 'added',
        order: 'desc',
        after: { keys: ['2026-01-04T00:00:00.000Z'], id: 'm3' },
      }),
    ).toEqual(['c', 'A'])
  })
})

describe('sources', () => {
  test('ready sources with absolute path and normalized probe', () => {
    movie('m')
    insertSource(db, {
      id: 'small',
      itemId: 'm',
      relativePath: 'Film (2020)/film.mkv',
      sizeBytes: 10,
      probe: {
        format: { format_name: 'matroska,webm', duration: '5400.5' },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            pix_fmt: 'yuv420p',
          },
          { index: 1, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
          {
            index: 2,
            codec_type: 'audio',
            codec_name: 'ac3',
            channels: 6,
            tags: { language: 'fre' },
            disposition: { default: 1 },
          },
          { index: 3, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'und' } },
        ],
      },
    })
    insertSource(db, {
      id: 'big',
      itemId: 'm',
      sizeBytes: 20,
      parsed: { title: 'M', editionName: 'Cut 4K' },
      probe: 'garbage',
    })
    insertSource(db, { id: 'gone', itemId: 'm', state: 'missing' })
    const [first, second, third] = repo.listReadySources({ itemId: 'm', scope: everything })
    expect(third).toBeUndefined()
    // §7.7 version: an unreadable probe gives no technical field, the edition stays.
    expect(first).toMatchObject({
      id: 'big',
      version: { editionName: 'Cut 4K' },
      rootReachable: true,
    })
    expect(first?.media).toBeUndefined()
    expect(second).toMatchObject({
      id: 'small',
      path: '/media/films/Film (2020)/film.mkv',
      extension: 'mkv',
      version: { resolution: '1080p', videoCodec: 'h264' },
      media: {
        formatName: 'matroska,webm',
        durationMs: 5_400_500,
        video: [{ index: 0, codec: 'h264', width: 1920, height: 1080, pixelFormat: 'yuv420p' }],
        audio: [{ index: 2, codec: 'ac3', channels: 6, language: 'fre', isDefault: true }],
        subtitles: [{ index: 3, codec: 'subrip', isDefault: false, forced: false }],
      },
    })
    expect(repo.findSource('gone')?.state).toBe('missing')
    expect(repo.findSource('nope')).toBeUndefined()
  })
})

describe('durations', () => {
  const probe = (durationS: string) => ({
    format: { duration: durationS },
    streams: [{ index: 0, codec_type: 'video', codec_name: 'h264' }],
  })

  test('movies and episodes carry the duration of their best probed ready source', () => {
    movie('m')
    insertSource(db, { id: 'small', itemId: 'm', sizeBytes: 10, probe: probe('100') })
    insertSource(db, { id: 'big', itemId: 'm', sizeBytes: 20, probe: probe('120.4') })
    insertSource(db, {
      id: 'huge',
      itemId: 'm',
      sizeBytes: 30,
      state: 'pending',
      probe: probe('1'),
    })
    movie('unprobed')
    insertSource(db, { id: 'raw', itemId: 'unprobed', probe: 'garbage' })
    seedSeries()
    db.update(sources)
      .set({ probe: probe('1500') })
      .where(eq(sources.id, 'f-s1e1'))
      .run()

    expect(repo.findVisible({ id: 'm', scope: everything })?.durationMs).toBe(120_400)
    expect(
      repo
        .listTopLevel({ kind: 'movie', sort: 'title', order: 'asc', limit: 10, scope: everything })
        .map((item) => [item.id, item.durationMs]),
    ).toEqual([
      ['m', 120_400],
      ['unprobed', undefined],
    ])
    expect(
      repo
        .listVisibleChildren({ parentId: 's1', scope: everything })
        .map((item) => [item.id, item.durationMs]),
    ).toEqual([
      ['s1e1', 1_500_000],
      ['s1e2', undefined],
    ])
    expect(repo.findVisible({ id: 'series', scope: everything })?.durationMs).toBeUndefined()
  })

  test('only sources in scope count', () => {
    movie('m')
    insertSource(db, { id: 'a', itemId: 'm', sizeBytes: 10, probe: probe('60') })
    insertSource(db, {
      id: 'b',
      itemId: 'm',
      sizeBytes: 20,
      libraryId: 'library-2',
      rootId: 'library-2-root',
      probe: probe('90'),
    })
    expect(repo.findVisible({ id: 'm', scope: { libraryIds: ['library-1'] } })?.durationMs).toBe(
      60_000,
    )
    expect(repo.findVisible({ id: 'm', scope: everything })?.durationMs).toBe(90_000)
  })
})
