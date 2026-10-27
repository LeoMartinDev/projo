import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { LibraryDto, SourcesPage } from '@projo/shared/api/libraries'
import type { AssignResponse, TmdbSearchResponse } from '@projo/shared/api/metadata'
import type { AdminSettingsDto } from '@projo/shared/api/settings'

import { seedViewer } from '../support/catalog-fixtures.ts'
import { createTempDir } from '../support/database.ts'
import { growFile, placeVideo } from '../support/media-fixtures.ts'
import { createMetadataWorld, type MetadataWorld } from '../support/metadata-world.ts'
import { TEST_TMDB_KEY } from '../support/tmdb-server.ts'

setDefaultTimeout(90_000)

let world: MetadataWorld
let media: ReturnType<typeof createTempDir>
let unique = 0
beforeEach(() => {
  world = createMetadataWorld()
  media = createTempDir('projo-metadata-media-')
})
afterEach(async () => {
  await world.stop()
  media.cleanup()
})

/** Each file its own size, hence its own signature (§7.6): no accidental "same file" lookups. */
const place = (relativePath: string): string => {
  const path = placeVideo(media.path, relativePath)
  unique += 1
  growFile(path, 4096 * unique)
  return path
}

const createLibrary = async (hint = 'auto') => {
  const response = await world.request('/libraries', {
    method: 'POST',
    json: { name: 'Vidéos', roots: [media.path], hint },
  })
  expect(response.status).toBe(201)
  const library = (await response.json()) as LibraryDto
  await world.runJobs(['scan_library'])
  return library
}

/** Quiet period, probes, then identification and images. */
const settle = async () => {
  world.clock.advance(121_000)
  world.jobQueue.enqueue({ type: 'watch_pending', payload: {}, dedupeKey: 'watch_pending' })
  await world.runJobs(['watch_pending'])
  await world.runJobs(['probe_source'])
  await world.runJobs(['match_source'])
  await world.runJobs(['fetch_images'])
}

const fullScan = async (libraryId: string) => {
  const response = await world.request(`/libraries/${libraryId}/scan`, {
    method: 'POST',
    json: { mode: 'full' },
  })
  expect(response.status).toBe(202)
  await world.runJobs(['scan_library'])
  await world.runJobs(['probe_source'])
  await world.runJobs(['match_source'])
  await world.runJobs(['fetch_images'])
}

type ItemRow = {
  id: string
  kind: string
  title: string
  tmdb_id?: number
  parent_id?: string
  year?: number
  overview?: string
  content_rating?: string
  content_rating_country?: string
  poster_image_id?: string
  backdrop_image_id?: string
  logo_image_id?: string
  still_image_id?: string
  episode_count_tmdb?: number
  series_status?: string
  last_air_date?: string
  imdb_id?: string
  tvdb_id?: number
  genres: string
}
const items = () => world.query<ItemRow>('SELECT * FROM items ORDER BY kind, title')
const sourceRow = (pathEnd: string) =>
  world.query<{ id: string; match_state: string; review_reason?: string; state: string }>(
    'SELECT id, match_state, review_reason, state FROM sources WHERE relative_path LIKE ?',
    `%${pathEnd}`,
  )[0]
const linksOf = (sourceId: string) =>
  world
    .query<{ item_id: string }>('SELECT item_id FROM source_items WHERE source_id = ?', sourceId)
    .map((row) => row.item_id)

describe('TMDB identification (§9.2)', () => {
  test('a movie: identified, enriched, cast, images downloaded and served', async () => {
    await world.setKey()
    place('Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.mkv')
    await createLibrary()
    await settle()

    const [movie] = items()
    expect(movie).toMatchObject({
      kind: 'movie',
      tmdb_id: 27205,
      title: 'Inception',
      year: 2010,
      imdb_id: 'tt1375666',
      // FR has no certification: US fallback (§9.1), filtered on the US scale (§14).
      content_rating: 'PG-13',
      content_rating_country: 'US',
    })
    expect(JSON.parse(movie?.genres ?? '[]')).toEqual(['action', 'science_fiction', 'adventure'])
    expect(movie?.overview).toContain('Dom Cobb')
    expect(sourceRow('.mkv')?.match_state).toBe('matched')

    const people = world.query<{ name: string; role: string; character?: string }>(
      `SELECT p.name, ip.role, ip.character FROM item_people ip JOIN people p ON p.id = ip.person_id
       ORDER BY ip.role, ip."order"`,
    )
    expect(people).toEqual([
      { name: 'Leonardo DiCaprio', role: 'cast', character: 'Dom Cobb' },
      { name: 'Joseph Gordon-Levitt', role: 'cast', character: 'Arthur' },
      { name: 'Elliot Page', role: 'cast', character: 'Ariadne' },
      { name: 'Tom Hardy', role: 'cast', character: 'Eames' },
      { name: 'Christopher Nolan', role: 'director' },
      { name: 'Christopher Nolan', role: 'writer' },
    ])

    // Poster in French first, textless backdrop, PNG logo (the SVG is skipped).
    const images = world.query<{ id: string; kind: string; tmdb_path: string; local_path: string }>(
      'SELECT id, kind, tmdb_path, local_path FROM images ORDER BY kind, tmdb_path',
    )
    const byKind = (kind: string) => images.filter((image) => image.kind === kind)
    expect(byKind('poster').map((i) => i.tmdb_path)).toEqual(['/aej3LRUga5rhgkmRP6XMFw3ejbl.jpg'])
    expect(byKind('backdrop').map((i) => i.tmdb_path)).toEqual(['/s3TBrRGB1iav7gFOCNx3H31MoES.jpg'])
    expect(byKind('logo').map((i) => i.tmdb_path)).toEqual(['/fr0aWVvRcIdlpmeXHVZxk8f1Q5E.png'])
    // Photos of the credited people who have one (Tom Hardy has none; Nolan once).
    expect(byKind('profile')).toHaveLength(4)
    for (const image of images) {
      expect(existsSync(join(world.data.path, 'images', image.local_path))).toBe(true)
    }
    expect(world.tmdb.requests.filter((r) => r.path.startsWith('/t/p/w500/'))).toHaveLength(2)
    expect(
      world.tmdb.requests.some((r) => r.path === '/t/p/w1280/s3TBrRGB1iav7gFOCNx3H31MoES.jpg'),
    ).toBe(true)
    expect(world.tmdb.requests.filter((r) => r.path.startsWith('/t/p/w185/'))).toHaveLength(4)

    // §9.1: served as its WebP variant (the fixture is narrower than the ladder: full size).
    const poster = await world.requestApi(`/images/${movie?.poster_image_id}?w=342`)
    expect(poster.status).toBe(200)
    expect(poster.headers.get('cache-control')).toContain('immutable')
    expect(poster.headers.get('content-type')).toBe('image/webp')
    expect((await poster.arrayBuffer()).byteLength).toBeGreaterThan(0)
    expect((await world.requestApi(`/images/${movie?.poster_image_id}?w=300`)).status).toBe(400)
    expect((await world.requestApi('/images/unknown-id')).status).toBe(404)
    // Variants not encoded yet: the original, cached an hour only.
    const posterPath = byKind('poster')[0]?.local_path ?? ''
    rmSync(join(world.data.path, 'images', posterPath.replace(/\.jpg$/u, '.full.webp')))
    const fallback = await world.requestApi(`/images/${movie?.poster_image_id}?w=342`)
    expect(fallback.headers.get('content-type')).toBe('image/jpeg')
    expect(fallback.headers.get('cache-control')).toBe('private, max-age=3600')
    // The daily `image_variants` encodes it again.
    world.jobQueue.enqueue({ type: 'image_variants', payload: {} })
    await world.runJobs(['image_variants'])
    expect(
      (await world.requestApi(`/images/${movie?.poster_image_id}`)).headers.get('content-type'),
    ).toBe('image/webp')

    // Idempotent: a second run downloads nothing.
    const before = world.tmdb.requests.length
    world.jobQueue.enqueue({ type: 'fetch_images', payload: { itemId: movie?.id } })
    await world.runJobs(['fetch_images'])
    expect(world.tmdb.requests.length).toBe(before)
  })

  test('an image is served only while its item is visible (§20)', async () => {
    await world.setKey()
    place('Inception (2010).mkv')
    await createLibrary()
    await settle()
    const [movie] = items()
    world.db.$client.run(`UPDATE sources SET state = 'missing'`)
    expect((await world.requestApi(`/images/${movie?.poster_image_id}`)).status).toBe(404)
  })

  test("with the catalog's profile scope, an image outside it is not found (§14)", async () => {
    await world.stop()
    const asked: { imageId: string; profileId: string }[] = []
    let allowed = false
    world = createMetadataWorld({
      canViewImage: (input) => {
        asked.push(input)
        return allowed
      },
    })
    await world.setKey()
    place('Inception (2010).mkv')
    await createLibrary()
    await settle()
    const [movie] = items()
    expect((await world.requestApi(`/images/${movie?.poster_image_id}`)).status).toBe(404)
    allowed = true
    expect((await world.requestApi(`/images/${movie?.poster_image_id}`)).status).toBe(200)
    expect(asked[0]).toEqual({ imageId: movie?.poster_image_id ?? '', profileId: 'profile-1' })
  })

  test('an id tag short-circuits the search; IMDb ids go through /find', async () => {
    await world.setKey()
    place('Un titre sans rapport {imdb-tt1375666}.mkv')
    await createLibrary()
    await settle()
    expect(items()).toMatchObject([{ kind: 'movie', tmdb_id: 27205, title: 'Inception' }])
    expect(world.tmdb.callsTo('search/movie')).toHaveLength(0)
    expect(world.tmdb.callsTo('find/tt1375666')).toHaveLength(1)
  })

  test('a series, its season and episodes; missing translations from en-US', async () => {
    await world.setKey()
    place('The Bear/Season 1/The.Bear.S01E01.1080p.WEB.mkv')
    place('The Bear/Season 1/The.Bear.S01E02.1080p.WEB.mkv')
    await createLibrary()
    await settle()

    const rows = items()
    const series = rows.find((row) => row.kind === 'series')
    const season = rows.find((row) => row.kind === 'season')
    const episodes = rows.filter((row) => row.kind === 'episode')
    expect(series).toMatchObject({
      tmdb_id: 136315,
      title: 'The Bear',
      year: 2022,
      content_rating: '16',
      series_status: 'in_production',
      // §13.5 "2022 – 2024".
      last_air_date: '2024-06-26',
      episode_count_tmdb: 28,
      tvdb_id: 402474,
    })
    expect(season).toMatchObject({
      // TMDB's "Saison 1" is generic: no title of its own (§6.3).
      title: '',
      tmdb_id: 209386,
      parent_id: series?.id,
      episode_count_tmdb: 8,
      content_rating: '16',
      content_rating_country: 'FR',
    })
    // Only the episodes with a file exist (§9.2 step 3).
    expect(episodes.map((e) => e.title).sort()).toEqual(['Hands', 'Système'])
    const hands = episodes.find((e) => e.title === 'Hands')
    expect(hands?.overview).toContain('health inspection')
    expect(hands?.still_image_id).toBeDefined()
    expect(season?.poster_image_id).toBeDefined()
    expect(series?.logo_image_id).toBeDefined()
    // One search for the series name, one season fetch (database cache) for both files.
    expect(world.tmdb.callsTo('search/tv')).toHaveLength(1)
    expect(
      world.tmdb.callsTo('tv/136315/season/1').filter((r) => r.params['language'] === 'fr-FR'),
    ).toHaveLength(1)
    // The second cast photo is gone from TMDB (404): skipped, not retried.
    expect(world.query('SELECT * FROM jobs WHERE state = ?', 'failed')).toEqual([])
  })

  test('a new episode file later: same series item, its season fetched again (§9.4)', async () => {
    await world.setKey()
    place('The Bear/Season 1/The.Bear.S01E01.mkv')
    const library = await createLibrary()
    await settle()
    const seriesId = items().find((row) => row.kind === 'series')?.id
    world.clock.advance(2 * 60 * 60_000)
    place('Vrac/The.Bear.S01E03.mkv')
    await fullScan(library.id)
    await settle()
    const rows = items()
    expect(rows.filter((row) => row.kind === 'series').map((row) => row.id)).toEqual([
      seriesId ?? '',
    ])
    expect(
      rows
        .filter((row) => row.kind === 'episode')
        .map((row) => row.title)
        .sort(),
    ).toEqual(['Brigade', 'Système'])
    expect(world.tmdb.callsTo('tv/136315/season/1').length).toBeGreaterThanOrEqual(2)
  })

  test('two strong candidates → needs_review (ambiguous_match), listed in "À vérifier"', async () => {
    await world.setKey()
    place('Dune.mkv')
    const library = await createLibrary('movies')
    await settle()
    expect(sourceRow('Dune.mkv')).toMatchObject({
      match_state: 'needs_review',
      review_reason: 'ambiguous_match',
    })
    // The local item stays: the file remains playable until someone decides.
    expect(items()).toMatchObject([{ kind: 'movie', title: 'Dune' }])
    expect(items()[0]?.tmdb_id).toBeUndefined()

    const response = await world.request(`/sources?libraryId=${library.id}&matchState=needs_review`)
    const page = (await response.json()) as SourcesPage
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      reviewReason: 'ambiguous_match',
      parsed: { title: 'Dune' },
      classification: 'movie',
    })
  })

  test('no TMDB result → needs_review (no_match)', async () => {
    await world.setKey()
    place('Un film introuvable (1999).mkv')
    place('Un autre film introuvable (2001).mkv')
    place('Inception (2010).mkv')
    await createLibrary('movies')
    await settle()
    expect(sourceRow('introuvable (1999).mkv')).toMatchObject({
      match_state: 'needs_review',
      review_reason: 'no_match',
    })
    // The queue size comes with every page (sidebar badge, §15), not only what the page holds.
    const page = (await (
      await world.request('/sources?matchState=needs_review&limit=1')
    ).json()) as SourcesPage
    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(2)
    expect(page.nextCursor).toBeDefined()
  })

  test('a saga prefix in the name: identified through the alternative titles', async () => {
    await world.setKey()
    place('Star Wars Episode VI Return of the Jedi (1983) MULTi 2160p x265-QTZ.mkv')
    await createLibrary('movies')
    await settle()
    expect(sourceRow('x265-QTZ.mkv')).toMatchObject({ match_state: 'matched' })
    expect(items()).toMatchObject([{ kind: 'movie', tmdb_id: 1892, title: 'Le Retour du Jedi' }])
    expect(world.tmdb.callsTo('movie/1892/alternative_titles')).toHaveLength(1)
  })

  test('homonymous series: the one with far more votes wins (§9.2)', async () => {
    await world.setKey()
    place('What If S01E07 MULTi 2160p WEBRip x265-QTZ.mkv')
    await createLibrary()
    await settle()
    expect(sourceRow('x265-QTZ.mkv')).toMatchObject({ match_state: 'matched' })
    expect(items().find((item) => item.kind === 'series')).toMatchObject({ tmdb_id: 91363 })
  })

  test('the year search returns only unrelated titles: searched again without it', async () => {
    await world.setKey()
    // 2021 on TMDB; the search with 2020 only finds "Norm of the North".
    place('BAC Nord (2020) French VOF 2160p 10bit 4KLight HDR BluRay x265-QTZ.mkv')
    await createLibrary('movies')
    await settle()
    expect(sourceRow('x265-QTZ.mkv')).toMatchObject({ match_state: 'matched' })
    expect(items()).toMatchObject([{ kind: 'movie', tmdb_id: 637534, title: 'BAC Nord' }])
    expect(world.tmdb.callsTo('search/movie').map((call) => call.params['year'])).toEqual([
      '2020',
      undefined,
    ])
  })
})

describe('"À vérifier" and corrections (§7.8, parcours 5)', () => {
  test('search, assign, and a full scan never undoes the correction', async () => {
    await world.setKey()
    place('Dune.mkv')
    const library = await createLibrary('movies')
    await settle()
    const source = sourceRow('Dune.mkv')

    const search = await world.request('/tmdb/search?q=Dune&kind=movie')
    expect(search.status).toBe(200)
    const found = (await search.json()) as TmdbSearchResponse
    expect(found.items.map((hit) => [hit.tmdbId, hit.year])).toEqual([
      [438631, 2021],
      [841, 1984],
      [1028703, 2021],
    ])

    const assigned = await world.request(`/sources/${source?.id}/assign`, {
      method: 'POST',
      json: { kind: 'movie', tmdbId: 438631 },
    })
    expect(assigned.status).toBe(200)
    const body = (await assigned.json()) as AssignResponse
    await world.runJobs(['fetch_images'])
    expect(sourceRow('Dune.mkv')?.match_state).toBe('manual')
    expect(world.query('SELECT tmdb_id, kind, created_by FROM manual_matches')).toEqual([
      { tmdb_id: 438631, kind: 'movie', created_by: 'admin-1' },
    ])
    const movie = items().find((row) => row.id === body.itemIds[0])
    expect(movie).toMatchObject({ tmdb_id: 438631, year: 2021, content_rating: '12' })
    // The local item was adopted: same id, nothing left behind.
    expect(items()).toHaveLength(1)

    await fullScan(library.id)
    await fullScan(library.id)
    expect(sourceRow('Dune.mkv')?.match_state).toBe('manual')
    expect(linksOf(source?.id ?? '')).toEqual(body.itemIds)
    expect(items().map((row) => row.tmdb_id)).toEqual([438631])
  })

  test('"c\'est un épisode de…": series chosen, numbers from the name; reject', async () => {
    await world.setKey()
    place('Inclassables/Carmy 02.mkv')
    place('Inclassables/Rushes.mkv')
    await createLibrary()
    await settle()
    const carmy = sourceRow('Carmy 02.mkv')
    const assigned = await world.request(`/sources/${carmy?.id}/assign`, {
      method: 'POST',
      json: { kind: 'episode', seriesTmdbId: 136315, seasonNumber: 1, episodeNumber: 2 },
    })
    expect(assigned.status).toBe(200)
    expect(sourceRow('Carmy 02.mkv')?.match_state).toBe('manual')
    expect(
      items()
        .filter((row) => row.kind === 'episode')
        .map((row) => row.title),
    ).toEqual(['Hands'])
    expect(world.query('SELECT kind, season_number, episode_number FROM manual_matches')).toEqual([
      { kind: 'episode', season_number: 1, episode_number: 2 },
    ])

    const missing = await world.request(`/sources/${carmy?.id}/assign`, {
      method: 'POST',
      json: { kind: 'episode', seriesTmdbId: 136315, seasonNumber: 1, episodeNumber: 40 },
    })
    expect(missing.status).toBe(422)

    const rushes = sourceRow('Rushes.mkv')
    const rejected = await world.request(`/sources/${rushes?.id}/reject`, { method: 'POST' })
    expect(rejected.status).toBe(204)
    expect(sourceRow('Rushes.mkv')?.state).toBe('rejected')
    expect(linksOf(rushes?.id ?? '')).toEqual([])

    // Shown again: back in "To review".
    await world.request(`/sources/${rushes?.id}/restore`, { method: 'POST' })
    await world.runJobs(['probe_source'])
    await world.runJobs(['match_source'])
    expect(sourceRow('Rushes.mkv')).toMatchObject({ state: 'ready', match_state: 'needs_review' })
  })

  test('"c\'est un épisode de…" takes along the other files to review of the series', async () => {
    await world.setKey()
    place('Ours/Season 1/Ours.S01E01.mkv')
    place('Ours/Season 1/Ours.S01E02.mkv')
    place('Ours/Season 1/Ours.S01E09.mkv')
    place('Autre/Season 1/Autre.S01E01.mkv')
    // Same show name, another show folder: left alone.
    place('Rangement/Ours/Season 1/Ours.S01E03.mkv')
    await createLibrary('series')
    await settle()
    expect(sourceRow('Ours.S01E02.mkv')).toMatchObject({
      match_state: 'needs_review',
      review_reason: 'no_match',
    })
    const e01 = sourceRow('Ours.S01E01.mkv')
    const e02 = sourceRow('Ours.S01E02.mkv')
    const e09 = sourceRow('Ours.S01E09.mkv')

    const assigned = await world.request(`/sources/${e01?.id}/assign`, {
      method: 'POST',
      json: { kind: 'episode', seriesTmdbId: 136315 },
    })
    expect(assigned.status).toBe(200)
    const body = (await assigned.json()) as AssignResponse
    expect(body.sourceIds.toSorted()).toEqual([e01?.id ?? '', e02?.id ?? ''].toSorted())
    // The Bear has 8 episodes in season 1: E09 stays in "To review".
    expect(body.needsReview).toEqual([
      { sourceId: e09?.id ?? '', seasonNumber: 1, episodeNumber: 9 },
    ])
    expect(sourceRow('Ours.S01E02.mkv')?.match_state).toBe('manual')
    expect(sourceRow('Ours.S01E09.mkv')).toMatchObject({
      match_state: 'needs_review',
      review_reason: 'episode_not_found',
    })
    // Another series, or the same name in another show folder, is left alone.
    expect(sourceRow('Autre.S01E01.mkv')).toMatchObject({
      match_state: 'needs_review',
      review_reason: 'no_match',
    })
    expect(sourceRow('Ours.S01E03.mkv')).toMatchObject({
      match_state: 'needs_review',
      review_reason: 'no_match',
    })
    expect(
      world.query<{ episode_number: number }>(
        'SELECT episode_number FROM manual_matches ORDER BY episode_number',
      ),
    ).toEqual([{ episode_number: 1 }, { episode_number: 2 }])
    expect(
      items()
        .filter((row) => row.kind === 'series' && row.tmdb_id === 136315)
        .map((row) => row.id),
    ).toHaveLength(1)
  })

  test('"c\'est un épisode de…" with typed numbers: that file alone', async () => {
    await world.setKey()
    place('Ours/Season 1/Ours.S01E01.mkv')
    place('Ours/Season 1/Ours.S01E02.mkv')
    await createLibrary('series')
    await settle()
    const e01 = sourceRow('Ours.S01E01.mkv')

    const assigned = await world.request(`/sources/${e01?.id}/assign`, {
      method: 'POST',
      json: { kind: 'episode', seriesTmdbId: 136315, seasonNumber: 1, episodeNumber: 5 },
    })
    expect(assigned.status).toBe(200)
    const body = (await assigned.json()) as AssignResponse
    expect(body).toMatchObject({ sourceIds: [e01?.id ?? ''], needsReview: [] })
    expect(sourceRow('Ours.S01E02.mkv')).toMatchObject({
      match_state: 'needs_review',
      review_reason: 'no_match',
    })
    // E01, identified already, does not follow E02.
    const again = await world.request(`/sources/${sourceRow('Ours.S01E02.mkv')?.id}/assign`, {
      method: 'POST',
      json: { kind: 'episode', seriesTmdbId: 136315, seasonNumber: 1, episodeNumber: 2 },
    })
    expect(((await again.json()) as AssignResponse).sourceIds).toHaveLength(1)
  })

  test('a library type change re-reads an identified file as the other kind (§7.4)', async () => {
    await world.setKey()
    place('Inception (2010).mkv')
    const library = await createLibrary()
    await settle()
    const source = sourceRow('Inception (2010).mkv')
    expect(source?.match_state).toBe('matched')

    const changed = await world.request(`/libraries/${library.id}`, {
      method: 'PATCH',
      json: { hint: 'series' },
    })
    expect(changed.status).toBe(200)
    await world.runJobs(['scan_library'])
    await world.runJobs(['match_source'])
    expect(sourceRow('Inception (2010).mkv')).toMatchObject({
      match_state: 'needs_review',
      review_reason: 'no_episode_number',
    })
    // No longer the movie: no number, so no local episode either.
    expect(linksOf(source?.id ?? '')).toEqual([])

    await world.request(`/libraries/${library.id}`, { method: 'PATCH', json: { hint: 'auto' } })
    await world.runJobs(['scan_library'])
    await world.runJobs(['match_source'])
    expect(sourceRow('Inception (2010).mkv')?.match_state).toBe('matched')
    const linked = items().find((row) => row.id === linksOf(source?.id ?? '')[0])
    expect(linked).toMatchObject({ kind: 'movie', tmdb_id: 27205 })
  })

  test('a hidden file stays hidden through full scans, shown again with its correction', async () => {
    await world.setKey()
    place('Dune.mkv')
    const library = await createLibrary('movies')
    await settle()
    const dune = sourceRow('Dune.mkv')
    await world.request(`/sources/${dune?.id}/assign`, {
      method: 'POST',
      json: { kind: 'movie', tmdbId: 841 },
    })
    await world.request(`/sources/${dune?.id}/reject`, { method: 'POST' })
    expect(sourceRow('Dune.mkv')).toMatchObject({ state: 'rejected', match_state: 'unmatched' })
    // Scans leave it alone, full ones included; only the admin shows it again.
    await world.request(`/libraries/${library.id}/scan`, { method: 'POST', json: {} })
    await world.runJobs(['scan_library'])
    expect(sourceRow('Dune.mkv')?.state).toBe('rejected')
    await fullScan(library.id)
    await settle()
    expect(sourceRow('Dune.mkv')).toMatchObject({ state: 'rejected', match_state: 'unmatched' })
    const hidden = await world.request('/sources?state=rejected')
    const page = (await hidden.json()) as SourcesPage
    expect(page.items.map((item) => item.id)).toEqual([dune?.id ?? ''])

    const restored = await world.request(`/sources/${dune?.id}/restore`, { method: 'POST' })
    expect(restored.status).toBe(204)
    // Checked now, without waiting for a quiet period.
    await world.runJobs(['probe_source'])
    await world.runJobs(['match_source'])
    expect(sourceRow('Dune.mkv')).toMatchObject({ state: 'ready', match_state: 'manual' })
    const again = await world.request(`/sources/${dune?.id}/restore`, { method: 'POST' })
    expect(again.status).toBe(409)
    const linked = items().find((row) => row.id === linksOf(dune?.id ?? '')[0])
    expect(linked?.tmdb_id).toBe(841)
  })

  test('"Corriger l\'identification" on an item', async () => {
    await world.setKey()
    place('Dune (2021).mkv')
    await createLibrary('movies')
    await settle()
    const [movie] = items()
    expect(movie?.tmdb_id).toBe(438631)
    const response = await world.request(`/items/${movie?.id}/rematch`, {
      method: 'POST',
      json: { kind: 'movie', tmdbId: 841 },
    })
    expect(response.status).toBe(200)
    const source = sourceRow('Dune (2021).mkv')
    expect(source?.match_state).toBe('manual')
    const linked = items().find((row) => row.id === linksOf(source?.id ?? '')[0])
    expect(linked).toMatchObject({ tmdb_id: 841, year: 1984 })
    // A season cannot be re-identified on its own.
    world.db.$client.run(
      `INSERT INTO items (id, kind, title, sort_title, created_at, updated_at) VALUES ('s1', 'season', 'S', 's', '2026-01-01', '2026-01-01')`,
    )
    const invalid = await world.request('/items/s1/rematch', {
      method: 'POST',
      json: { kind: 'movie', tmdbId: 841 },
    })
    expect(invalid.status).toBe(400)
  })

  test('a rematch moves progress and Ma liste from the TMDB item left without file', async () => {
    await world.setKey()
    place('Dune (2021).mkv')
    await createLibrary('movies')
    await settle()
    const [dune] = items()
    const viewer = seedViewer(world.db, 'viewer-1')
    world.db.$client
      .query(
        `INSERT INTO playback_progress (profile_id, item_id, position_ms, duration_ms, watched, play_count, last_played_at)
         VALUES (?, ?, 4500000, 9000000, 0, 1, '2026-05-03T10:00:00.000Z')`,
      )
      .run(viewer.profileId, dune?.id ?? '')
    world.db.$client
      .query(`INSERT INTO watchlist (profile_id, item_id, added_at) VALUES (?, ?, ?)`)
      .run(viewer.profileId, dune?.id ?? '', '2026-05-02T10:00:00.000Z')

    const response = await world.request(`/items/${dune?.id}/rematch`, {
      method: 'POST',
      json: { kind: 'movie', tmdbId: 841 },
    })
    expect(response.status).toBe(200)
    const [linked] = ((await response.json()) as AssignResponse).itemIds
    expect(linked).not.toBe(dune?.id)
    expect(world.query('SELECT item_id, position_ms FROM playback_progress')).toEqual([
      { item_id: linked, position_ms: 4_500_000 },
    ])
    expect(world.query('SELECT item_id FROM watchlist')).toEqual([{ item_id: linked }])
  })

  test('a series rematch moves each episode, then the series rows once it has no file', async () => {
    await world.setKey()
    place('The Bear/Season 1/The.Bear.S01E01.mkv')
    place('The Bear/Season 1/The.Bear.S01E02.mkv')
    await createLibrary('series')
    await settle()
    const bear = items().find((row) => row.kind === 'series')
    expect(bear?.tmdb_id).toBe(136315)
    const e02 = items().find(
      (row) => row.kind === 'episode' && linksOf(sourceRow('S01E02.mkv')?.id ?? '')[0] === row.id,
    )
    const viewer = seedViewer(world.db, 'viewer-1')
    world.db.$client
      .query(
        `INSERT INTO playback_progress (profile_id, item_id, position_ms, duration_ms, watched, play_count, last_played_at)
         VALUES (?, ?, 120000, 1800000, 0, 1, '2026-05-03T10:00:00.000Z')`,
      )
      .run(viewer.profileId, e02?.id ?? '')
    world.db.$client
      .query(`INSERT INTO watchlist (profile_id, item_id, added_at) VALUES (?, ?, ?)`)
      .run(viewer.profileId, bear?.id ?? '', '2026-05-02T10:00:00.000Z')

    const response = await world.request(`/items/${bear?.id}/rematch`, {
      method: 'POST',
      json: { kind: 'series', tmdbId: 95396 },
    })
    expect(response.status).toBe(200)
    const severance = items().find((row) => row.kind === 'series' && row.tmdb_id === 95396)
    const newE02 = linksOf(sourceRow('S01E02.mkv')?.id ?? '')[0]
    expect(world.query('SELECT item_id, position_ms FROM playback_progress')).toEqual([
      { item_id: newE02, position_ms: 120_000 },
    ])
    expect(world.query('SELECT item_id FROM watchlist')).toEqual([{ item_id: severance?.id }])
  })

  test('rematch of a series: all or nothing, episodes the new series lacks go to review', async () => {
    place('Ours/Season 1/Ours.S01E01.mkv')
    place('Ours/Season 1/Ours.S01E09.mkv')
    await createLibrary('series')
    await settle()
    const local = items().find((row) => row.kind === 'series')
    expect(local?.tmdb_id).toBeUndefined()
    await world.setKey()

    const response = await world.request(`/items/${local?.id}/rematch`, {
      method: 'POST',
      json: { kind: 'series', tmdbId: 136315 },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as AssignResponse
    const e01 = sourceRow('Ours.S01E01.mkv')
    const e09 = sourceRow('Ours.S01E09.mkv')
    // The Bear has 8 episodes in season 1: E09 waits in "To review", E01 moved.
    expect(body.sourceIds).toEqual([e01?.id ?? ''])
    expect(body.needsReview).toEqual([
      { sourceId: e09?.id ?? '', seasonNumber: 1, episodeNumber: 9 },
    ])
    expect(e01?.match_state).toBe('manual')
    expect(e09).toMatchObject({ match_state: 'needs_review', review_reason: 'episode_not_found' })
    const hands = items().find((row) => row.id === linksOf(e01?.id ?? '')[0])
    expect(hands?.tmdb_id).toBeDefined()
    expect(linksOf(e09?.id ?? '')).toHaveLength(1)
    expect(world.query('SELECT relative_path FROM manual_matches')).toEqual([
      { relative_path: 'Ours/Season 1/Ours.S01E01.mkv' },
    ])
  })

  test('a correction survives the purge of its source: the file coming back gets it again', async () => {
    await world.setKey()
    const path = place('Dune.mkv')
    // Another file: an emptied root would be held as unreachable rather than missing (§7.5).
    place('Inception (2010).mkv')
    const library = await createLibrary('movies')
    await settle()
    const first = sourceRow('Dune.mkv')
    await world.request(`/sources/${first?.id}/assign`, {
      method: 'POST',
      json: { kind: 'movie', tmdbId: 841 },
    })
    // The file goes away, its missing source is purged (the row is deleted).
    const bytes = await Bun.file(path).arrayBuffer()
    rmSync(path)
    await fullScan(library.id)
    expect(sourceRow('Dune.mkv')?.state).toBe('missing')
    world.db.$client.run('DELETE FROM sources WHERE id = ?', [first?.id ?? ''])
    expect(world.query('SELECT relative_path, tmdb_id FROM manual_matches')).toEqual([
      { relative_path: 'Dune.mkv', tmdb_id: 841 },
    ])
    // Back at the same path, with other bytes (no signature match): a new source, same decision.
    await Bun.write(path, new Uint8Array([...new Uint8Array(bytes), 0, 1, 2, 3]))
    await fullScan(library.id)
    await settle()
    const again = sourceRow('Dune.mkv')
    expect(again?.id).not.toBe(first?.id)
    expect(again?.match_state).toBe('manual')
    const linked = items().find((row) => row.id === linksOf(again?.id ?? '')[0])
    expect(linked?.tmdb_id).toBe(841)
    expect(world.query('SELECT source_id FROM manual_matches')).toEqual([{ source_id: again?.id }])
  })

  test('a correction is found again by signature when the file comes back as a new source', async () => {
    await world.setKey()
    const original = place('Dune.mkv')
    const library = await createLibrary('movies')
    await settle()
    const first = sourceRow('Dune.mkv')
    await world.request(`/sources/${first?.id}/assign`, {
      method: 'POST',
      json: { kind: 'movie', tmdbId: 841 },
    })
    // A copy elsewhere, same bytes: a new source with the same signature.
    placeVideo(media.path, 'Copie/Dune.mkv', original)
    await fullScan(library.id)
    await settle()
    const copy = world.query<{ id: string; match_state: string }>(
      `SELECT id, match_state FROM sources WHERE relative_path = 'Copie/Dune.mkv'`,
    )[0]
    expect(copy?.match_state).toBe('manual')
    const linked = items().find((row) => row.id === linksOf(copy?.id ?? '')[0])
    expect(linked?.tmdb_id).toBe(841)
  })
})

describe('without a TMDB key, then with one (§9.1)', () => {
  test('a stored key TMDB refuses later shows as rejected until a key is set again', async () => {
    await world.setKey()
    const state = async () =>
      ((await (await world.request('/settings')).json()) as AdminSettingsDto).metadata.tmdbApiKey
        .state
    expect(await state()).toBe('valid')
    // The key is revoked on TMDB's side: the next request is answered 401.
    world.db.$client.run(
      `UPDATE settings SET value = '"revoked-key-0123456789abcdef"' WHERE key = 'metadata.tmdb_api_key'`,
    )
    expect((await world.request('/tmdb/search?q=Dune&kind=movie')).status).toBe(502)
    expect(await state()).toBe('rejected')
    await world.setKey()
    expect(await state()).toBe('valid')
  })

  test('sources stay local, one notification; the key relaunches and progress survives the fusion', async () => {
    place('Inception (2010).mkv')
    place('Autre nom [tmdbid-27205].mkv')
    await createLibrary('movies')
    await settle()

    // M1 behaviour: two local items, nothing from TMDB, a single open notification.
    expect(items().map((row) => [row.title, row.tmdb_id])).toEqual([
      ['Autre nom', undefined],
      ['Inception', undefined],
    ])
    expect(sourceRow('Inception (2010).mkv')?.match_state).toBe('unmatched')
    const open = () =>
      world.query<{ kind: string }>(
        'SELECT kind FROM notifications WHERE resolved_at IS NULL AND kind = ?',
        'metadata/tmdb_key_missing',
      )
    expect(open()).toHaveLength(1)
    expect(world.tmdb.requests).toHaveLength(0)

    // Progress on both local items, for the same profile.
    const viewer = seedViewer(world.db, 'viewer-1')
    const inception = items().find((row) => row.title === 'Inception')
    const other = items().find((row) => row.title === 'Autre nom')
    const progress = world.db.$client.query(
      `INSERT INTO playback_progress (profile_id, item_id, position_ms, duration_ms, watched, play_count, last_played_at)
       VALUES (?, ?, ?, 8880000, ?, ?, ?)`,
    )
    progress.run(viewer.profileId, inception?.id ?? '', 600_000, 0, 1, '2026-05-01T10:00:00.000Z')
    progress.run(viewer.profileId, other?.id ?? '', 4_200_000, 1, 2, '2026-05-20T10:00:00.000Z')
    world.db.$client
      .query(`INSERT INTO watchlist (profile_id, item_id, added_at) VALUES (?, ?, ?)`)
      .run(viewer.profileId, other?.id ?? '', '2026-05-02T10:00:00.000Z')

    // A wrong key is refused, the right one relaunches the matching.
    const refused = await world.setKey('not-a-valid-tmdb-key-123456')
    expect(refused.status).toBe(422)
    const saved = await world.setKey()
    expect(saved.status).toBe(200)
    const settings = (await saved.json()) as AdminSettingsDto
    expect(settings.metadata.tmdbApiKey).toEqual({
      configured: true,
      state: 'valid',
      last4: TEST_TMDB_KEY.slice(-4),
    })
    expect(JSON.stringify(settings)).not.toContain(TEST_TMDB_KEY)
    expect(open()).toHaveLength(0)
    await world.runJobs(['match_source'])
    await world.runJobs(['fetch_images'])

    // One TMDB item: the first local item matched is adopted (same id), the other merged into it.
    const rows = items()
    expect(rows.map((row) => row.tmdb_id)).toEqual([27205])
    const kept = rows[0]?.id
    expect([inception?.id, other?.id]).toContain(kept)
    expect(
      world.query('SELECT position_ms, watched, play_count, last_played_at FROM playback_progress'),
    ).toEqual([
      {
        position_ms: 4_200_000,
        watched: 1,
        play_count: 3,
        last_played_at: '2026-05-20T10:00:00.000Z',
      },
    ])
    expect(world.query('SELECT item_id FROM playback_progress')).toEqual([{ item_id: kept }])
    expect(world.query('SELECT item_id FROM watchlist')).toEqual([{ item_id: kept }])
    expect(world.endedItems.flat()).toEqual(
      [inception?.id ?? '', other?.id ?? ''].filter((id) => id !== kept),
    )
  })

  test('an episode joining a known series: its local series rows move to the TMDB series', async () => {
    await world.setKey()
    place('The Bear/Season 1/The.Bear.S01E01.mkv')
    const library = await createLibrary()
    await settle()
    const tmdbSeries = items().find((row) => row.kind === 'series')
    // Without key, a new file gets local items (a second "The Bear" series).
    await world.setKey('')
    place('Vrac/The.Bear.S01E03.mkv')
    await fullScan(library.id)
    await settle()
    const localSeries = items().find((row) => row.kind === 'series' && row.tmdb_id === undefined)
    const localEpisode = items().find((row) => row.kind === 'episode' && row.tmdb_id === undefined)
    expect(localSeries).toBeDefined()
    const viewer = seedViewer(world.db, 'viewer-1')
    world.db.$client
      .query(`INSERT INTO watchlist (profile_id, item_id, added_at) VALUES (?, ?, ?)`)
      .run(viewer.profileId, localSeries?.id ?? '', '2026-05-02T10:00:00.000Z')
    world.db.$client
      .query(
        `INSERT INTO playback_progress (profile_id, item_id, position_ms, duration_ms, watched, play_count, last_played_at)
         VALUES (?, ?, 120000, 1800000, 0, 1, '2026-05-03T10:00:00.000Z')`,
      )
      .run(viewer.profileId, localEpisode?.id ?? '')

    await world.setKey()
    await world.runJobs(['match_source'])
    const series = items().filter((row) => row.kind === 'series')
    expect(series.map((row) => row.id)).toEqual([tmdbSeries?.id ?? ''])
    const brigade = items().find((row) => row.title === 'Brigade')
    expect(brigade?.tmdb_id).toBe(3_500_003)
    expect(world.query('SELECT item_id, position_ms FROM playback_progress')).toEqual([
      { item_id: brigade?.id, position_ms: 120_000 },
    ])
    expect(world.query('SELECT item_id FROM watchlist')).toEqual([{ item_id: tmdbSeries?.id }])
  })

  test('GET /admin/settings never returns the key', async () => {
    const empty = (await (await world.request('/settings')).json()) as AdminSettingsDto
    expect(empty.metadata).toEqual({
      language: 'fr-FR',
      tmdbApiKey: { configured: false, state: 'missing' },
    })
    // §15 "Playback" and "Server" (M5 contract): §24 defaults, environment shown read-only.
    expect(empty.playback).toEqual({
      maxConcurrentTranscodes: 2,
      audioDownmix: 'stereo',
      burnInEnabled: true,
      transcodeCacheMaxGb: 10,
      trickplayEnabled: true,
      hwAccel: 'off',
    })
    expect(empty.server).toMatchObject({ name: 'projo', trustProxy: false })
    await world.setKey()
    const set = (await (await world.request('/settings')).json()) as AdminSettingsDto
    expect(set.metadata.tmdbApiKey.configured).toBe(true)
    expect(JSON.stringify(set)).not.toContain(TEST_TMDB_KEY)
    const changed = await world.request('/settings', {
      method: 'PATCH',
      json: { metadata: { language: 'en-US' } },
    })
    expect(((await changed.json()) as AdminSettingsDto).metadata.language).toBe('en-US')
  })

  test('PATCH /admin/settings: "Lecture" and "Serveur" are stored and read back (§15)', async () => {
    const changed = await world.request('/settings', {
      method: 'PATCH',
      json: {
        playback: {
          maxConcurrentTranscodes: 4,
          audioDownmix: 'keep',
          trickplayEnabled: false,
          hwAccel: 'vaapi',
        },
        server: { name: '  Maison  ' },
      },
    })
    expect(changed.status).toBe(200)
    const body = (await changed.json()) as AdminSettingsDto
    expect(body.playback).toEqual({
      maxConcurrentTranscodes: 4,
      audioDownmix: 'keep',
      burnInEnabled: true,
      transcodeCacheMaxGb: 10,
      trickplayEnabled: false,
      hwAccel: 'vaapi',
    })
    expect(body.server.name).toBe('Maison')
    // What the playback use cases read on their next session or job (§10).
    expect(
      world.query(
        "SELECT key, value FROM settings WHERE key LIKE 'playback.%' OR key = 'server.name' ORDER BY key",
      ),
    ).toEqual([
      { key: 'playback.audio_downmix', value: '"keep"' },
      { key: 'playback.hw_accel', value: '"vaapi"' },
      { key: 'playback.max_concurrent_transcodes', value: '4' },
      { key: 'playback.trickplay_enabled', value: 'false' },
      { key: 'server.name', value: '"Maison"' },
    ])
    const invalid = await world.request('/settings', {
      method: 'PATCH',
      json: { playback: { maxConcurrentTranscodes: 0 } },
    })
    expect(invalid.status).toBe(400)
  })
})
