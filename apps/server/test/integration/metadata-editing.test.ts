import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { ok } from '@projo/shared'
import type { JobRef } from '@projo/shared/api/jobs'
import type { ImageAlternativesResponse, ItemMetadataDto } from '@projo/shared/api/metadata'

import type { ImageReencoder } from '../../src/core/metadata/editing.ts'
import { insertItem, insertLibrary, insertSource } from '../support/catalog-fixtures.ts'
import { createMetadataWorld, type MetadataWorld } from '../support/metadata-world.ts'

/** Stands for ffmpeg (tested on its own): the bytes come back as they are. */
const reencoded: { type: string; kind: string }[] = []
const fakeReencoder: ImageReencoder = {
  reencode: async ({ bytes, type, kind }) => {
    reencoded.push({ type, kind })
    return ok({ bytes, extension: type === 'png' ? 'png' : 'jpg', width: 1000, height: 1500 })
  },
}

let world: MetadataWorld
beforeEach(async () => {
  reencoded.length = 0
  world = createMetadataWorld({ imageReencoder: fakeReencoder })
  await world.setKey()
  insertLibrary(world.db)
})
afterEach(async () => {
  await world.stop()
})

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code

const send = (method: string, path: string, json?: unknown) =>
  world.request(path, { method, ...(json === undefined ? {} : { json }) })

const editor = async (itemId: string) => {
  const response = await world.request(`/items/${itemId}`)
  expect(response.status).toBe(200)
  return (await response.json()) as ItemMetadataDto
}

const items = (sql: string, ...params: string[]) =>
  world.query<Record<string, unknown>>(sql, ...params)

const imageFile = (imageId: string) => {
  const [row] = items('SELECT local_path FROM images WHERE id = ?', imageId)
  return row === undefined ? undefined : join(world.data.path, 'images', String(row['local_path']))
}

const imageIdOf = (url: string | undefined) => url?.replace('/api/v1/images/', '') ?? ''

/** The identified movie Inception (TMDB 27205), its metadata and images fetched once. */
const seedMovie = async () => {
  insertItem(world.db, { id: 'movie', kind: 'movie', tmdbId: 27205, title: 'Inception' })
  insertSource(world.db, { id: 'src-movie', itemId: 'movie' })
  expect((await send('POST', '/items/movie/refresh')).status).toBe(202)
  await world.runJobs(['refresh_metadata', 'fetch_images'])
}

/** The Bear (TMDB 136315): season 1 with its episodes 1 and 2 on disk, nothing else. */
const seedSeries = () => {
  insertItem(world.db, { id: 'series', kind: 'series', tmdbId: 136315, title: 'The Bear' })
  insertItem(world.db, {
    id: 's1',
    kind: 'season',
    parentId: 'series',
    tmdbId: 205726,
    seasonNumber: 1,
    title: 'Saison 1',
  })
  for (const n of [1, 2]) {
    insertItem(world.db, {
      id: `e${n}`,
      kind: 'episode',
      parentId: 's1',
      tmdbId: 1000 + n,
      seasonNumber: 1,
      episodeNumber: n,
      title: `Episode ${n}`,
    })
    insertSource(world.db, { id: `src-e${n}`, itemId: `e${n}` })
  }
}

describe('editing and locks (§9.3)', () => {
  test('an edit locks the field; a refresh writes everything else; "Revenir à TMDB" puts it back', async () => {
    await seedMovie()
    const fresh = await editor('movie')
    expect(fresh).toMatchObject({
      id: 'movie',
      kind: 'movie',
      tmdbId: 27205,
      title: 'Inception',
      year: 2010,
      genres: ['action', 'science_fiction', 'adventure'],
      locked: [],
    })
    expect(fresh.images.poster).toStartWith('/api/v1/images/')
    expect(fresh.metadataRefreshedAt).toBeString()

    const patched = await send('PATCH', '/items/movie', {
      title: 'Origine',
      year: 2011,
      genres: ['science_fiction', 'drama', 'science_fiction'],
    })
    expect(patched.status).toBe(200)
    expect(await patched.json()).toMatchObject({
      title: 'Origine',
      year: 2011,
      genres: ['science_fiction', 'drama'],
      locked: ['title', 'year', 'genres'],
    })
    expect(world.events.some((event) => event.type === 'catalog.changed')).toBe(true)

    // Overview edited by hand in the database, then a refresh: TMDB writes it, locks hold.
    world.db.$client.run(`UPDATE items SET overview = 'stale' WHERE id = 'movie'`)
    expect((await send('POST', '/items/movie/refresh')).status).toBe(202)
    await world.runJobs(['refresh_metadata'])
    const refreshed = await editor('movie')
    expect(refreshed).toMatchObject({
      title: 'Origine',
      year: 2011,
      genres: ['science_fiction', 'drama'],
    })
    expect(refreshed.overview).toStartWith('Dom Cobb')

    const back = await send('DELETE', '/items/movie/overrides/title')
    expect(back.status).toBe(200)
    expect(await back.json()).toMatchObject({ title: 'Inception', locked: ['year', 'genres'] })
    // Idempotent.
    expect((await send('DELETE', '/items/movie/overrides/title')).status).toBe(200)
    expect(items(`SELECT sort_title FROM items WHERE id = 'movie'`)).toEqual([
      { sort_title: 'inception' },
    ])
  })

  test('a rematch keeps the locked fields (§9.3)', async () => {
    await seedMovie()
    await send('PATCH', '/items/movie', { overview: 'Mon résumé' })
    const rematch = await send('POST', '/items/movie/rematch', { kind: 'movie', tmdbId: 27205 })
    expect(rematch.status).toBe(200)
    expect(await editor('movie')).toMatchObject({ overview: 'Mon résumé', locked: ['overview'] })
  })

  test('validation, unknown items, local items', async () => {
    insertItem(world.db, { id: 'local', kind: 'movie', title: 'Vacances 2019' })
    expect((await send('PATCH', '/items/local', {})).status).toBe(400)
    expect((await send('PATCH', '/items/local', { year: 1500 })).status).toBe(400)
    // Genres come from the fixed list (§9.3): a free name is refused.
    expect((await send('PATCH', '/items/local', { genres: ['Comédie'] })).status).toBe(400)
    expect((await send('PATCH', '/items/local', { title: 'Vacances' })).status).toBe(200)
    expect((await send('DELETE', '/items/local/overrides/rating')).status).toBe(400)
    // A local item: edits yes, no TMDB value to come back to, no refresh nor alternatives.
    const back = await send('DELETE', '/items/local/overrides/title')
    expect(await back.json()).toMatchObject({ title: 'Vacances', locked: [] })
    const refresh = await send('POST', '/items/local/refresh')
    expect([refresh.status, await errorCode(refresh)]).toEqual([409, 'metadata/not_matched'])
    const alternatives = await world.request('/items/local/images/alternatives?kind=poster')
    expect([alternatives.status, await errorCode(alternatives)]).toEqual([
      409,
      'metadata/not_matched',
    ])
    for (const [method, path] of [
      ['GET', '/items/nope'],
      ['PATCH', '/items/nope'],
      ['DELETE', '/items/nope/overrides/title'],
      ['POST', '/items/nope/refresh'],
    ] as const) {
      const response = await send(method, path, method === 'PATCH' ? { title: 'x' } : undefined)
      expect([path, response.status, await errorCode(response)]).toEqual([
        path,
        404,
        'item/not_found',
      ])
    }
  })
})

describe('images (§9.3, §20)', () => {
  test('TMDB alternatives, best voted first; choosing one locks it and drops the old file', async () => {
    await seedMovie()
    const before = await editor('movie')
    const oldPoster = imageIdOf(before.images.poster)
    const oldFile = imageFile(oldPoster)
    expect(oldFile !== undefined && existsSync(oldFile)).toBe(true)

    const listed = await world.request('/items/movie/images/alternatives?kind=poster')
    expect(listed.status).toBe(200)
    const { items: posters } = (await listed.json()) as ImageAlternativesResponse
    expect(posters.map((image) => [image.tmdbPath, image.current])).toEqual([
      ['/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', false],
      ['/aej3LRUga5rhgkmRP6XMFw3ejbl.jpg', true],
      ['/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg', false],
    ])
    expect(posters[0]).toMatchObject({ width: 2000, height: 3000, language: 'en' })

    const chosen = await send('POST', '/items/movie/images', {
      kind: 'poster',
      tmdbPath: '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg',
    })
    expect(chosen.status).toBe(200)
    const after = (await chosen.json()) as ItemMetadataDto
    expect(after.locked).toEqual(['poster'])
    expect(after.images.poster).not.toBe(before.images.poster)
    expect(items('SELECT id FROM images WHERE id = ?', oldPoster)).toEqual([])
    expect(oldFile !== undefined && existsSync(oldFile)).toBe(false)
    expect(
      world.tmdb.requests.some((r) => r.path === '/t/p/w500/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg'),
    ).toBe(true)

    // A refresh and its images job never replace a locked image.
    await send('POST', '/items/movie/refresh')
    await world.runJobs(['refresh_metadata', 'fetch_images'])
    expect((await editor('movie')).images.poster).toBe(after.images.poster)

    // "Back to the TMDB value": TMDB's own choice comes back at once.
    const back = await send('DELETE', '/items/movie/overrides/poster')
    const restored = (await back.json()) as ItemMetadataDto
    expect(restored.locked).toEqual([])
    const restoredId = imageIdOf(restored.images.poster)
    expect(items('SELECT tmdb_path FROM images WHERE id = ?', restoredId)).toEqual([
      { tmdb_path: '/aej3LRUga5rhgkmRP6XMFw3ejbl.jpg' },
    ])
  })

  test('uploads: magic bytes, 10 MB, re-encoded into images/custom', async () => {
    await seedMovie()
    const upload = (bytes: Uint8Array, kind = 'backdrop', name = 'image.jpg') => {
      const form = new FormData()
      form.set('kind', kind)
      form.set('file', new File([bytes], name, { type: 'image/jpeg' }))
      return world.request('/items/movie/images', { method: 'POST', body: form })
    }
    const svg = await upload(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    expect([svg.status, await errorCode(svg)]).toEqual([415, 'image/unsupported_type'])
    const huge = new Uint8Array(10 * 1024 * 1024 + 1)
    huge.set([0xff, 0xd8, 0xff])
    const tooLarge = await upload(huge)
    expect([tooLarge.status, await errorCode(tooLarge)]).toEqual([413, 'image/too_large'])
    // A declared length past the limit is refused before the body is read.
    const declared = await world.request('/items/movie/images', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(64 * 1024 * 1024),
      },
      body: '--x--\r\n',
    })
    expect([declared.status, await errorCode(declared)]).toEqual([413, 'image/too_large'])
    expect(reencoded).toEqual([])

    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const uploaded = await upload(png, 'backdrop', 'disguised.jpg')
    expect(uploaded.status).toBe(200)
    const dto = (await uploaded.json()) as ItemMetadataDto
    expect(dto.locked).toEqual(['backdrop'])
    expect(reencoded).toEqual([{ type: 'png', kind: 'backdrop' }])
    const id = imageIdOf(dto.images.backdrop)
    expect(items('SELECT origin, local_path, width FROM images WHERE id = ?', id)).toEqual([
      { origin: 'custom', local_path: `custom/${id}.png`, width: 1000 },
    ])
    const file = imageFile(id)
    expect(file !== undefined && existsSync(file)).toBe(true)
    // Served like any image of a visible item.
    expect((await world.requestApi(dto.images.backdrop?.replace('/api/v1', '') ?? '')).status).toBe(
      200,
    )

    // Back to TMDB: the custom file goes.
    const back = await send('DELETE', '/items/movie/overrides/backdrop')
    expect(((await back.json()) as ItemMetadataDto).locked).toEqual([])
    expect(file !== undefined && existsSync(file)).toBe(false)
  })

  test('a season offers its posters and the series backdrops; an episode the series images', async () => {
    seedSeries()
    const seasonPosters = (await (
      await world.request('/items/s1/images/alternatives?kind=poster')
    ).json()) as ImageAlternativesResponse
    expect(seasonPosters.items.map((image) => image.tmdbPath)).toEqual([
      '/q7XhCpJDjLs3gUzAa0gHGcIDCeD.jpg',
      '/zMSqLqUHo4XWdbBZ6cbN2ENpUkf.jpg',
      '/b1sQiHqmLk8Bq4YKJt0pFz9wVqR.jpg',
    ])
    const seasonBackdrops = (await (
      await world.request('/items/s1/images/alternatives?kind=backdrop')
    ).json()) as ImageAlternativesResponse
    expect(seasonBackdrops.items.map((image) => image.tmdbPath)).toEqual([
      '/ijt9t5xGVuRJlA4xmAG1Kc5aj4g.jpg',
    ])
    const episodeBackdrops = (await (
      await world.request('/items/e1/images/alternatives?kind=backdrop')
    ).json()) as ImageAlternativesResponse
    expect(episodeBackdrops.items).toEqual(seasonBackdrops.items)
    expect(world.tmdb.callsTo('tv/136315/season/1/images')).toHaveLength(1)
  })

  test('the admin TMDB proxy serves w185 and w300 only', async () => {
    const small = await world.request('/tmdb/posters/aej3LRUga5rhgkmRP6XMFw3ejbl.jpg')
    expect(small.status).toBe(200)
    const wide = await world.request('/tmdb/posters/ijt9t5xGVuRJlA4xmAG1Kc5aj4g.jpg?size=w300')
    expect(wide.status).toBe(200)
    expect((await world.request('/tmdb/posters/x.jpg?size=original')).status).toBe(400)
    expect(
      world.tmdb.requests.map((r) => r.path).filter((path) => path.startsWith('/t/p/')),
    ).toEqual([
      '/t/p/w185/aej3LRUga5rhgkmRP6XMFw3ejbl.jpg',
      '/t/p/w300/ijt9t5xGVuRJlA4xmAG1Kc5aj4g.jpg',
    ])
  })
})

describe('refresh (§9.4)', () => {
  test('a series: its seasons and episodes with files, nothing created, locks kept', async () => {
    seedSeries()
    await send('PATCH', '/items/e1', { title: 'Mon épisode' })
    const response = await send('POST', '/items/series/refresh')
    expect(response.status).toBe(202)
    const { jobId } = (await response.json()) as JobRef
    expect(jobId).toBeString()
    expect(await world.runJobs(['refresh_metadata'])).toBe(1)
    expect(
      items(`SELECT id, title, series_status, episode_count_tmdb FROM items ORDER BY kind, id`),
    ).toEqual([
      { id: 'e1', title: 'Mon épisode' },
      // Missing in French: from en-US (§9.1).
      { id: 'e2', title: 'Hands' },
      // TMDB's "Saison 1" is generic: no title of its own (§6.3).
      { id: 's1', title: '', episode_count_tmdb: expect.any(Number) },
      {
        id: 'series',
        title: 'The Bear',
        series_status: 'in_production',
        episode_count_tmdb: expect.any(Number),
      },
    ])
    // Images of every refreshed item follow.
    expect(
      items(`SELECT payload FROM jobs WHERE type = 'fetch_images' AND state = 'queued'`),
    ).toHaveLength(4)
    // `catalog.changed` at the end comes from the job's end (`catalog-changes`).
    expect(items(`SELECT state FROM jobs WHERE type = 'refresh_metadata'`)).toEqual([
      { state: 'done' },
    ])
  })

  test('a whole library: one low-priority job per identified movie or series', async () => {
    await seedMovie()
    seedSeries()
    insertItem(world.db, { id: 'local', kind: 'movie', title: 'Vacances' })
    insertSource(world.db, { id: 'src-local', itemId: 'local' })

    const missing = await send('POST', '/libraries/nope/refresh-metadata')
    expect([missing.status, await errorCode(missing)]).toEqual([404, 'library/not_found'])
    const response = await send('POST', '/libraries/library-1/refresh-metadata')
    expect(response.status).toBe(202)
    // Asked twice: one job.
    const again = (await (
      await send('POST', '/libraries/library-1/refresh-metadata')
    ).json()) as JobRef
    expect(again.jobId).toBe(((await response.json()) as JobRef).jobId)

    expect(await world.runJobs(['refresh_metadata'], 1)).toBe(1)
    expect(
      items(
        `SELECT payload, priority FROM jobs WHERE type = 'refresh_metadata' AND state = 'queued' ORDER BY payload`,
      ),
    ).toEqual([
      { payload: JSON.stringify({ itemId: 'movie' }), priority: 10 },
      { payload: JSON.stringify({ itemId: 'series' }), priority: 10 },
    ])
    expect(await world.runJobs(['refresh_metadata'])).toBe(2)
  })

  test('the weekly task queues in-production series a week after their last refresh', async () => {
    seedSeries()
    await send('POST', '/items/series/refresh')
    await world.runJobs(['refresh_metadata'])
    const [task] = world.metadata.scheduledTasks
    expect(task?.name).toBe('metadata-in-production-refresh')
    await task?.run()
    expect(
      items(`SELECT id FROM jobs WHERE type = 'refresh_metadata' AND state = 'queued'`),
    ).toEqual([])
    world.clock.advance(7 * 24 * 60 * 60_000 + 1)
    await task?.run()
    await task?.run()
    expect(
      items(`SELECT payload FROM jobs WHERE type = 'refresh_metadata' AND state = 'queued'`),
    ).toEqual([{ payload: JSON.stringify({ itemId: 'series' }) }])
  })
})
