import { beforeEach, describe, expect, test } from 'bun:test'

import type { GenreList, ItemChildren, ItemDetailDto, ItemPage } from '@projo/shared/api/catalog'
import type { HomeDto } from '@projo/shared/api/home'
import type { SearchResults } from '@projo/shared/api/search'
import type { WatchlistStatus } from '@projo/shared/api/watchlist'

import { createCatalogTestApp } from '../../../../test/support/catalog-app.ts'
import {
  insertCredit,
  insertImage,
  insertItem,
  insertLibrary,
  insertSource,
  seedSeries,
  seedViewer,
} from '../../../../test/support/catalog-fixtures.ts'
import { sourceItems } from '../../../infrastructure/sqlite/schema/libraries.ts'

/**
 * The spectator API over HTTP (§13, §17.2): home, catalog sorts and filters, details, search,
 * progress actions, "My list", and the §14 scope of a restricted profile.
 */

let app: ReturnType<typeof createCatalogTestApp>

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T
const get = async <T>(path: string, as = 'leo') => json<T>(await app.call(path, { as }))
const hour = 3_600_000

beforeEach(() => {
  app = createCatalogTestApp({ scopes: { 'profile-of-kid': { allowedRatings: { FR: ['TP'] } } } })
  const { db } = app
  seedViewer(db, 'leo')
  seedViewer(db, 'kid')
  insertLibrary(db)
  insertImage(db, 'poster-heat')
  insertImage(db, 'backdrop-heat', 'backdrop')
  insertItem(db, {
    id: 'heat',
    kind: 'movie',
    title: 'Heat',
    sortTitle: 'heat',
    year: 1995,
    voteAverage: 7.9,
    contentRating: '12',
    genres: ['crime', 'drama'],
    posterImageId: 'poster-heat',
    backdropImageId: 'backdrop-heat',
    addedAt: '2026-02-01T00:00:00.000Z',
  })
  insertSource(db, { id: 'f-heat', itemId: 'heat' })
  insertItem(db, {
    id: 'amelie',
    kind: 'movie',
    title: "Le Fabuleux Destin d'Amélie Poulain",
    originalTitle: 'Amélie',
    sortTitle: 'fabuleux destin',
    year: 2001,
    contentRating: 'TP',
    genres: ['comedy'],
    addedAt: '2026-02-02T00:00:00.000Z',
  })
  insertSource(db, { id: 'f-amelie', itemId: 'amelie' })
  seedSeries(db, {
    id: 'show',
    title: 'The Office',
    sortTitle: 'office',
    contentRating: 'TP',
    episodeCountTmdb: 22,
    addedAt: '2026-01-15T00:00:00.000Z',
    // S1E3 has no file.
    episodes: [
      [1, 1],
      [1, 2],
      [1, 4],
      [2, 1],
    ],
  })
  insertCredit(db, {
    itemId: 'show',
    personId: 'steve',
    name: 'Steve Carell',
    character: 'Michael',
  })
  insertCredit(db, { itemId: 'show', personId: 'greg', name: 'Greg Daniels', role: 'director' })
})

const play = (itemId: string, ratio: number, as = 'leo') =>
  app.call(`/items/${itemId}/progress`, {
    as,
    method: 'PUT',
    json: { positionMs: Math.round(ratio * hour), durationMs: hour },
  })

describe('GET /home', () => {
  test('a new profile: hero from the latest addition, only "Ajoutés récemment"', async () => {
    const home = await get<HomeDto>('/home')
    expect(home.rows.map((row) => row.kind)).toEqual(['recently_added'])
    const recent = home.rows[0]
    expect(recent?.kind === 'recently_added' && recent.items.map((item) => item.id)).toEqual([
      'amelie',
      'heat',
      'show',
    ])
    expect(home.hero).toMatchObject({
      item: { id: 'amelie', genres: ['comedy'], inWatchlist: false },
      play: { action: 'play', itemId: 'amelie', positionMs: 0 },
    })
  })

  test('Continuer à regarder: the sprite frame of the resume position, when there is one', async () => {
    const asked: { itemId: string; positionMs: number; profileId: string }[] = []
    app = createCatalogTestApp({
      homeResumeFrames: (input) => {
        asked.push(input)
        return input.itemId === 'heat'
          ? {
              sourceId: 'f-heat',
              sheet: 1,
              x: 640,
              y: 180,
              width: 320,
              height: 180,
              sheetWidth: 3200,
              sheetHeight: 1800,
            }
          : undefined
      },
    })
    seedViewer(app.db, 'leo')
    insertLibrary(app.db)
    insertItem(app.db, { id: 'heat', kind: 'movie', title: 'Heat', sortTitle: 'heat' })
    insertSource(app.db, { id: 'f-heat', itemId: 'heat' })
    insertItem(app.db, { id: 'other', kind: 'movie', title: 'Other', sortTitle: 'other' })
    insertSource(app.db, { id: 'f-other', itemId: 'other' })
    expect((await play('heat', 0.5)).status).toBe(200)
    app.clock.advance(60_000)
    expect((await play('other', 0.25)).status).toBe(200)

    const home = await get<HomeDto>('/home')
    const row = home.rows.find((entry) => entry.kind === 'continue_watching')
    const items = row?.kind === 'continue_watching' ? row.items : []
    expect(items.map((item) => item.id)).toEqual(['other', 'heat'])
    // No sprites for "other": no frame, the card keeps its image.
    expect(items[0]).not.toHaveProperty('resumeFrame')
    expect(items[1]?.resumeFrame).toEqual({
      url: '/api/v1/trickplay/f-heat/1.jpg',
      x: 640,
      y: 180,
      width: 320,
      height: 180,
      sheetWidth: 3200,
      sheetHeight: 1800,
    })
    expect(asked).toContainEqual({
      itemId: 'heat',
      positionMs: hour / 2,
      profileId: 'profile-of-leo',
    })
  })

  test('Continuer à regarder, À suivre, hero, Ma liste — one request', async () => {
    expect((await play('heat', 0.5)).status).toBe(200)
    app.clock.advance(60_000)
    expect((await play('show-s1e2', 0.97)).status).toBe(200)
    await app.call('/watchlist/amelie', { method: 'POST' })

    const home = await get<HomeDto>('/home')
    expect(home.rows.map((row) => row.kind)).toEqual([
      'continue_watching',
      'up_next',
      'recently_added',
      'watchlist',
    ])
    const [resume, next, , listed] = home.rows
    // The episode card's "My list" button acts on its series.
    await app.call('/watchlist/show', { method: 'POST' })
    const again = await get<HomeDto>('/home')
    const upNextRow = again.rows.find((row) => row.kind === 'up_next')
    expect(upNextRow?.kind === 'up_next' && upNextRow.items[0]?.episode.series).toMatchObject({
      id: 'show',
      inWatchlist: true,
    })
    expect(resume?.kind === 'continue_watching' && resume.items).toMatchObject([
      {
        id: 'heat',
        images: { backdrop: '/api/v1/images/backdrop-heat' },
        progress: { state: 'in_progress', resumePositionMs: hour / 2 },
      },
    ])
    // S1E3 is absent: after S1E2 comes S1E4.
    expect(next?.kind === 'up_next' && next.items).toMatchObject([
      {
        episode: { id: 'show-s1e4', seasonNumber: 1, episodeNumber: 4, series: { id: 'show' } },
        isNew: false,
      },
    ])
    expect(listed?.kind === 'watchlist' && listed.items.map((item) => item.id)).toEqual(['amelie'])
    // The series was played last: the hero is "Play S1 · E4" on it.
    expect(home.hero).toMatchObject({
      item: { id: 'show', kind: 'series' },
      episode: { id: 'show-s1e4' },
      play: { action: 'play', itemId: 'show-s1e4', seasonNumber: 1, episodeNumber: 4 },
    })
  })

  test('"Retirer" hides a series from both rows until the next play', async () => {
    await play('show-s1e1', 0.97)
    await play('show-s1e2', 0.4)
    const hidden = await app.call('/items/show-s1e2/hide-from-continue', { method: 'POST' })
    expect(await json(hidden)).toEqual({ itemId: 'show-s1e2', hiddenItemId: 'show' })
    let home = await get<HomeDto>('/home')
    expect(home.rows.map((row) => row.kind)).toEqual(['recently_added'])

    app.clock.advance(60_000)
    await play('show-s1e2', 0.5)
    home = await get<HomeDto>('/home')
    expect(home.rows.map((row) => row.kind)).toEqual(['continue_watching', 'recently_added'])
    expect(home.hero).toMatchObject({
      item: { id: 'show' },
      play: { action: 'resume', itemId: 'show-s1e2', positionMs: hour / 2 },
    })
  })

  test('the hero never falls back on an addition the profile removed', async () => {
    app.db.$client.run(`UPDATE items SET added_at = '2026-03-01T00:00:00.000Z' WHERE id = 'show'`)
    await play('show-s1e1', 0.97)
    await play('show-s1e2', 0.4)
    await app.call('/items/show-s1e2/hide-from-continue', { method: 'POST' })
    const home = await get<HomeDto>('/home')
    expect(home.rows.map((row) => row.kind)).toEqual(['recently_added'])
    expect(home.hero?.item.id).toBe('amelie')
  })

  test('a finished movie leaves "Continuer"; an unknown item cannot be hidden', async () => {
    await play('heat', 0.5)
    await play('heat', 0.95)
    const home = await get<HomeDto>('/home')
    expect(home.rows.some((row) => row.kind === 'continue_watching')).toBe(false)
    expect((await app.call('/items/nope/hide-from-continue', { method: 'POST' })).status).toBe(404)
  })
})

describe('Films / Séries', () => {
  test('sorts, filters, cursor', async () => {
    const byYear = await get<ItemPage>('/movies?sort=year&limit=1')
    expect(byYear.items.map((item) => item.id)).toEqual(['amelie'])
    expect(byYear.nextCursor).toBeDefined()
    const next = await get<ItemPage>(
      `/movies?sort=year&limit=1&cursor=${encodeURIComponent(byYear.nextCursor ?? '')}`,
    )
    expect(next.items.map((item) => item.id)).toEqual(['heat'])
    expect((await get<ItemPage>('/movies?genre=crime')).items.map((item) => item.id)).toEqual([
      'heat',
    ])
    // A genre is an id (§9.1): a TMDB name is refused.
    expect((await app.call('/movies?genre=Crime')).status).toBe(400)
    expect((await get<ItemPage>('/movies?decade=2000')).items.map((item) => item.id)).toEqual([
      'amelie',
    ])
    expect((await app.call('/movies?decade=1995')).status).toBe(400)
    expect((await app.call('/movies?year=1995&decade=1990')).status).toBe(400)
    // A cursor of another sort is refused.
    expect((await app.call(`/movies?sort=title&cursor=${byYear.nextCursor ?? ''}`)).status).toBe(
      400,
    )
  })

  test('watch filter and genres', async () => {
    await play('heat', 0.97)
    expect((await get<ItemPage>('/movies?watch=watched')).items.map((item) => item.id)).toEqual([
      'heat',
    ])
    expect((await get<ItemPage>('/movies?watch=unwatched')).items.map((item) => item.id)).toEqual([
      'amelie',
    ])
    await play('show-s1e1', 0.97)
    expect((await get<ItemPage>('/series?watch=in_progress')).items.map((item) => item.id)).toEqual(
      ['show'],
    )
    // Ids in the order of `genreIds` (the web sorts by label), with the bounds of the year filter
    // (§13.4); the series has no year.
    expect(await get<GenreList>('/genres')).toEqual({
      genres: ['comedy', 'crime', 'drama'],
      years: { min: 1995, max: 2001 },
    })
    expect(await get<GenreList>('/genres?kind=series')).toEqual({ genres: [] })
  })
})

describe('card and detail fields (§13.3–§13.5)', () => {
  test('genres, "4K HDR", seasons, "2023 – 2025", "Depuis le début"', async () => {
    const probe = (width: number, height: number, dynamicRange: string) =>
      JSON.stringify({ video: [{ index: 0, codec: 'hevc', width, height, dynamicRange }] })
    app.db.$client.run(`UPDATE sources SET probe = ? WHERE id = 'f-heat'`, [
      probe(3840, 2160, 'hdr'),
    ])
    app.db.$client.run(`UPDATE sources SET probe = ? WHERE id = 'f-show-s1e2'`, [
      probe(1920, 1080, 'sdr'),
    ])
    app.db.$client.run(`UPDATE sources SET probe = ? WHERE id = 'f-show-s2e1'`, [
      probe(3840, 2160, 'sdr'),
    ])
    app.db.$client.run(
      `UPDATE items SET year = 2023, last_air_date = '2025-03-01' WHERE id = 'show'`,
    )

    const movies = await get<ItemPage>('/movies')
    expect(movies.items.find((item) => item.id === 'heat')).toMatchObject({
      genres: ['crime', 'drama'],
      bestQuality: { resolution: '2160p', dynamicRange: 'hdr' },
    })
    expect(movies.items.find((item) => item.id === 'amelie')?.bestQuality).toBeUndefined()
    const [show] = (await get<ItemPage>('/series')).items
    expect(show).toMatchObject({
      seasonCount: 2,
      year: 2023,
      endYear: 2025,
      bestQuality: { resolution: '2160p', dynamicRange: 'sdr' },
    })
    expect(await get<ItemDetailDto>('/items/show')).toMatchObject({
      seasonCount: 2,
      endYear: 2025,
      firstEpisodeId: 'show-s1e1',
    })
    expect((await get<ItemDetailDto>('/items/show-s2')).firstEpisodeId).toBe('show-s2e1')
    expect((await get<ItemDetailDto>('/items/heat')).firstEpisodeId).toBeUndefined()
  })

  test('classification: its code, its country and its §14 tier (§9.1)', async () => {
    app.db.$client.run(
      `UPDATE items SET content_rating_country = 'FR' WHERE id IN ('heat', 'show')`,
    )
    app.db.$client.run(
      `UPDATE items SET content_rating = 'R', content_rating_country = 'US' WHERE id = 'amelie'`,
    )
    const movies = (await get<ItemPage>('/movies')).items
    expect(movies.find((item) => item.id === 'heat')?.contentRating).toEqual({
      code: '12',
      country: 'FR',
      tier: '12',
    })
    // The US fallback of a French library keeps its own scale.
    const fallback = { code: 'R', country: 'US', tier: '18' } as const
    expect(movies.find((item) => item.id === 'amelie')?.contentRating).toEqual(fallback)
    expect((await get<HomeDto>('/home')).hero?.item.contentRating).toEqual(fallback)
    expect((await get<ItemDetailDto>('/items/show')).contentRating).toEqual({
      code: 'TP',
      country: 'FR',
      tier: '0',
    })
    // Not on its country's scale: no tier.
    app.db.$client.run(`UPDATE items SET content_rating = 'NR' WHERE id = 'amelie'`)
    expect((await get<ItemDetailDto>('/items/amelie')).contentRating).toEqual({
      code: 'NR',
      country: 'US',
    })
    // Enriched before the country was stored: the code alone.
    app.db.$client.run(`UPDATE items SET content_rating_country = NULL WHERE id = 'heat'`)
    expect((await get<ItemDetailDto>('/items/heat')).contentRating).toEqual({ code: '12' })
  })
})

describe('GET /items/:id', () => {
  test('a series: counters, cast and crew, "Reprendre S2 · É4" / "Lire"', async () => {
    let show = await get<ItemDetailDto>('/items/show')
    expect(show).toMatchObject({
      episodeCountTmdb: 22,
      contentRating: { code: 'TP' },
      watchStatus: { watchedCount: 0, totalCount: 4 },
      cast: [{ id: 'steve', name: 'Steve Carell', character: 'Michael', role: 'cast' }],
      crew: [{ id: 'greg', role: 'director' }],
      play: { action: 'play', itemId: 'show-s1e1' },
      inWatchlist: false,
      audioLanguages: [],
    })
    await play('show-s2e1', 0.25)
    show = await get<ItemDetailDto>('/items/show')
    expect(show.play).toEqual({
      action: 'resume',
      itemId: 'show-s2e1',
      seasonNumber: 2,
      episodeNumber: 1,
      title: 'show-s2e1',
      positionMs: hour / 4,
    })
    // The season page plays within its season.
    expect((await get<ItemDetailDto>('/items/show-s1')).play).toMatchObject({
      itemId: 'show-s1e1',
    })
  })

  test('bulk "vu" on a season, then the series', async () => {
    const season = await app.call('/items/show-s1/watched', { method: 'POST' })
    expect(await json(season)).toMatchObject({
      watchStatus: { state: 'watched', watchedCount: 3, totalCount: 3 },
    })
    expect((await get<ItemDetailDto>('/items/show')).watchStatus).toMatchObject({
      state: 'partial',
      watchedCount: 3,
      totalCount: 4,
    })
    await app.call('/items/show/watched', { method: 'DELETE' })
    expect((await get<ItemDetailDto>('/items/show')).watchStatus?.watchedCount).toBe(0)
  })
})

describe('GET /items/:id/children', () => {
  test('a multi-episode file (§8.4): its first episode carries the end of the range', async () => {
    const { db } = app
    insertItem(db, { id: 'show-s3', kind: 'season', parentId: 'show', seasonNumber: 3 })
    const episode = (number: number) =>
      insertItem(db, {
        id: `show-s3e${number}`,
        kind: 'episode',
        parentId: 'show-s3',
        seasonNumber: 3,
        episodeNumber: number,
      })
    for (const number of [1, 2, 3, 4, 5, 6]) episode(number)
    // S03E01-E02 and S03E04-E06 are one file each; S03E05 also has its own, bigger, file.
    insertSource(db, { id: 'f-s3e1-e2', itemId: 'show-s3e1' })
    db.insert(sourceItems).values({ sourceId: 'f-s3e1-e2', itemId: 'show-s3e2' }).run()
    insertSource(db, { id: 'f-s3e3', itemId: 'show-s3e3' })
    insertSource(db, { id: 'f-s3e4-e6', itemId: 'show-s3e4' })
    for (const itemId of ['show-s3e5', 'show-s3e6'])
      db.insert(sourceItems).values({ sourceId: 'f-s3e4-e6', itemId }).run()
    insertSource(db, { id: 'f-s3e5', itemId: 'show-s3e5', sizeBytes: 5000 })

    const { items } = await get<ItemChildren>('/items/show-s3/children')
    expect(items.map((item) => [item.episodeNumber, item.episodeNumberEnd])).toEqual([
      [1, 2],
      [2, undefined],
      [3, undefined],
      [4, 6],
      [5, undefined],
      [6, undefined],
    ])
    // A single file per episode: no range.
    const first = await get<ItemChildren>('/items/show-s1/children')
    expect(first.items.every((item) => item.episodeNumberEnd === undefined)).toBe(true)
  })
})

describe('GET /search', () => {
  test('accent insensitive, movies and series apart', async () => {
    expect(await get<SearchResults>('/search?q=AMELIE')).toMatchObject({
      movies: [{ id: 'amelie' }],
      series: [],
    })
    expect(await get<SearchResults>('/search?q=offi')).toMatchObject({
      movies: [],
      series: [{ id: 'show' }],
    })
    expect((await app.call('/search?q=a')).status).toBe(400)
  })
})

describe('Ma liste', () => {
  test('add (idempotent), status, page by date of addition, remove', async () => {
    const added = await json<WatchlistStatus>(await app.call('/watchlist/heat', { method: 'POST' }))
    expect(added).toMatchObject({ itemId: 'heat', inWatchlist: true })
    app.clock.advance(1000)
    await app.call('/watchlist/show', { method: 'POST' })
    app.clock.advance(1000)
    const again = await json<WatchlistStatus>(await app.call('/watchlist/heat', { method: 'POST' }))
    expect(again.addedAt).toBe(added.addedAt)

    const first = await get<ItemPage>('/watchlist?limit=1')
    expect(first.items.map((item) => item.id)).toEqual(['show'])
    const second = await get<ItemPage>(
      `/watchlist?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    )
    expect(second.items.map((item) => item.id)).toEqual(['heat'])
    expect(second.nextCursor).toBeUndefined()
    expect((await get<ItemDetailDto>('/items/heat')).inWatchlist).toBe(true)

    await app.call('/watchlist/heat', { method: 'DELETE' })
    expect(await get<WatchlistStatus>('/watchlist/heat')).toEqual({
      itemId: 'heat',
      inWatchlist: false,
    })
    expect((await app.call('/watchlist/show-s1e1', { method: 'POST' })).status).toBe(400)
    expect((await app.call('/watchlist/nope', { method: 'POST' })).status).toBe(404)
  })
})

describe('§14 a restricted profile', () => {
  test('what exceeds its rating does not exist anywhere', async () => {
    await play('heat', 0.5, 'kid')
    expect((await get<ItemPage>('/movies', 'kid')).items.map((item) => item.id)).toEqual(['amelie'])
    expect((await app.call('/items/heat', { as: 'kid' })).status).toBe(404)
    expect((await play('heat', 0.6, 'kid')).status).toBe(404)
    expect((await app.call('/watchlist/heat', { as: 'kid', method: 'POST' })).status).toBe(404)
    expect((await get<SearchResults>('/search?q=heat', 'kid')).movies).toEqual([])
    const home = await get<HomeDto>('/home', 'kid')
    const recent = home.rows.find((row) => row.kind === 'recently_added')
    expect(recent?.items.map((item) => ('id' in item ? item.id : ''))).toEqual(['amelie', 'show'])
    expect(app.imageAccess.canView({ imageId: 'poster-heat', profileId: 'profile-of-kid' })).toBe(
      false,
    )
    expect(app.imageAccess.canView({ imageId: 'poster-heat', profileId: 'profile-of-leo' })).toBe(
      true,
    )
  })
})
