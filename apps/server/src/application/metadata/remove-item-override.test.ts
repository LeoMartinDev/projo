import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import { tmdbFailure } from '../../../test/support/metadata-fakes.ts'
import {
  notFound,
  now,
  createEditingWorld as setup,
} from '../../../test/support/metadata-editing-world.ts'
import type { ItemMetadata } from '../../core/metadata/enrichment.ts'

describe('"Back to TMDB"', () => {
  test('an unknown item: item/not_found', async () => {
    expect(await setup().removeItemOverride({ itemId: 'nope', field: 'title' })).toMatchObject(
      notFound,
    )
  })

  test('a text field gets the current TMDB value back', async () => {
    const tmdbValue: ItemMetadata = { title: 'Inception', year: 2010, genres: ['action'] }
    const world = setup({ currentMetadata: async () => ok(tmdbValue) })
    world.stored.set('movie', { title: 'Mine', year: 1999 })
    const result = await world.removeItemOverride({ itemId: 'movie', field: 'title' })
    expect(world.overridesRemoved).toEqual([
      { itemId: 'movie', field: 'title', restored: { title: 'Inception' }, at: now },
    ])
    expect(result.ok && result.value.locked).toEqual(['year'])
    expect(world.events).toEqual([{ type: 'catalog.changed', payload: {} }])
  })

  test('TMDB unreachable: the lock goes anyway, the value stays until the next refresh', async () => {
    const world = setup({ currentMetadata: async () => tmdbFailure() })
    world.stored.set('movie', { genres: ['drama'] })
    const result = await world.removeItemOverride({ itemId: 'movie', field: 'genres' })
    expect(world.overridesRemoved).toEqual([{ itemId: 'movie', field: 'genres', at: now }])
    expect(result.ok && result.value.locked).toEqual([])
  })

  test('an image: unlocked, then the TMDB images fetched again', async () => {
    const world = setup()
    world.stored.set('movie', { posterImageId: 'custom' })
    const result = await world.removeItemOverride({ itemId: 'movie', field: 'poster' })
    expect(world.overridesRemoved).toEqual([{ itemId: 'movie', field: 'poster_image_id', at: now }])
    expect(world.fetchedFor).toEqual(['movie'])
    expect(result.ok).toBe(true)
  })

  test('an image whose fetch fails is still unlocked, with a warning', async () => {
    const world = setup({
      fetchImages: async () => err(appError('metadata/image_failed', 'download failed')),
    })
    const result = await world.removeItemOverride({ itemId: 'movie', field: 'backdrop' })
    expect(result.ok).toBe(true)
    expect(world.lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({ code: 'metadata/image_failed' }),
      }),
    )
  })

  test('the image of a local item is only unlocked', async () => {
    const world = setup()
    await world.removeItemOverride({ itemId: 'local', field: 'poster' })
    expect(world.overridesRemoved).toHaveLength(1)
    expect(world.fetchedFor).toEqual([])
  })
})
