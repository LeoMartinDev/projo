import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import { tmdbFailure } from '../../../test/support/metadata-fakes.ts'
import {
  notFound,
  poster,
  createEditingWorld as setup,
  storedImage,
} from '../../../test/support/metadata-editing-world.ts'

describe('image alternatives', () => {
  test('an unknown item: item/not_found', async () => {
    expect(await setup().listImageAlternatives({ itemId: 'nope', kind: 'poster' })).toMatchObject(
      notFound,
    )
  })

  test('a local item: metadata/not_matched', async () => {
    expect(await setup().listImageAlternatives({ itemId: 'local', kind: 'poster' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/not_matched', context: { id: 'local' } },
    })
  })

  test('best voted first, then the widest, the current one flagged', async () => {
    const world = setup({
      tmdb: {
        images: async () =>
          ok({
            posters: [
              poster('/low.jpg', { voteAverage: 3 }),
              poster('/narrow.jpg', { voteAverage: 8, width: 500, height: 750 }),
              poster('/wide.jpg', { voteAverage: 8, width: 2000, height: 3000, language: 'fr' }),
            ],
            backdrops: [poster('/backdrop.jpg')],
            logos: [],
          }),
      },
      slots: { 'movie:poster': 'p' },
      storedImages: [storedImage('p', { tmdbPath: '/narrow.jpg' })],
    })
    const result = await world.listImageAlternatives({ itemId: 'movie', kind: 'poster' })
    expect(result).toEqual(
      ok([
        {
          tmdbPath: '/wide.jpg',
          width: 2000,
          height: 3000,
          voteAverage: 8,
          language: 'fr',
          current: false,
        },
        { tmdbPath: '/narrow.jpg', width: 500, height: 750, voteAverage: 8, current: true },
        { tmdbPath: '/low.jpg', width: 1000, height: 1500, voteAverage: 3, current: false },
      ]),
    )
    expect(world.tmdbCallsTo('images')).toEqual([
      { target: { kind: 'movie', tmdbId: 27205 }, language: 'fr-FR' },
    ])
  })

  test('at most 60 alternatives', async () => {
    const posters = Array.from({ length: 61 }, (_, i) => poster(`/${i}.jpg`))
    const world = setup({ tmdb: { images: async () => ok({ posters, backdrops: [], logos: [] }) } })
    const result = await world.listImageAlternatives({ itemId: 'movie', kind: 'poster' })
    expect(result.ok && result.value).toHaveLength(60)
  })

  test('a season offers its own posters, the series backdrops, in its library language', async () => {
    const world = setup({
      items: [{ id: 'season', kind: 'season', genres: [], tmdbId: 900 }],
      contexts: [
        {
          id: 'season',
          kind: 'season',
          tmdbId: 900,
          seasonNumber: 2,
          seriesTmdbId: 70523,
          libraryLanguage: 'de-DE',
        },
      ],
    })
    await world.listImageAlternatives({ itemId: 'season', kind: 'poster' })
    await world.listImageAlternatives({ itemId: 'season', kind: 'backdrop' })
    expect(world.tmdbCallsTo('images')).toEqual([
      { target: { kind: 'season', seriesTmdbId: 70523, seasonNumber: 2 }, language: 'de-DE' },
      { target: { kind: 'series', tmdbId: 70523 }, language: 'de-DE' },
    ])
  })

  test('an episode offers the series images; without its series id, not_matched', async () => {
    const world = setup({
      items: [
        { id: 'episode', kind: 'episode', genres: [], tmdbId: 1001 },
        { id: 'orphan', kind: 'episode', genres: [], tmdbId: 1002 },
      ],
      contexts: [
        { id: 'episode', kind: 'episode', tmdbId: 1001, seriesTmdbId: 70523 },
        { id: 'orphan', kind: 'episode', tmdbId: 1002 },
      ],
    })
    await world.listImageAlternatives({ itemId: 'episode', kind: 'poster' })
    expect(world.tmdbCallsTo('images')).toEqual([
      { target: { kind: 'series', tmdbId: 70523 }, language: 'fr-FR' },
    ])
    expect(await world.listImageAlternatives({ itemId: 'orphan', kind: 'poster' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/not_matched' },
    })
  })

  test('a TMDB failure is returned', async () => {
    const world = setup({ tmdb: { images: async () => tmdbFailure() } })
    expect(await world.listImageAlternatives({ itemId: 'movie', kind: 'poster' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/tmdb_unavailable' },
    })
  })
})
