import { describe, expect, test } from 'bun:test'

import {
  notFound,
  now,
  createEditingWorld as setup,
} from '../../../test/support/metadata-editing-world.ts'

describe('editing text fields (§9.3)', () => {
  test('an unknown item: nothing stored, nothing published', () => {
    const world = setup()
    expect(world.setItemOverrides({ itemId: 'nope', overrides: { title: 'X' } })).toMatchObject(
      notFound,
    )
    expect(world.overridesSet).toEqual([])
    expect(world.events).toEqual([])
  })

  test('stored as overrides, the catalog told, the fields now locked', () => {
    const world = setup()
    const result = world.setItemOverrides({
      itemId: 'movie',
      overrides: { title: 'Mine', genres: ['drama'] },
    })
    expect(world.overridesSet).toEqual([
      { itemId: 'movie', overrides: { title: 'Mine', genres: ['drama'] }, at: now },
    ])
    expect(world.events).toEqual([{ type: 'catalog.changed', payload: {} }])
    expect(result.ok && result.value.locked).toEqual(['title', 'genres'])
  })
})
