import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  movieItem,
  notFound,
  createEditingWorld as setup,
} from '../../../test/support/metadata-editing-world.ts'

describe('reading an item', () => {
  test('an unknown item: item/not_found', () => {
    expect(setup().getItemMetadata({ itemId: 'nope' })).toMatchObject(notFound)
  })

  test('the item with the fields its overrides lock', () => {
    const world = setup()
    world.stored.set('movie', { title: 'Mine', posterImageId: 'img' })
    expect(world.getItemMetadata({ itemId: 'movie' })).toEqual(
      ok({ ...movieItem, locked: ['title', 'poster'] }),
    )
  })
})
