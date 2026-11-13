import { describe, expect, test } from 'bun:test'

import {
  lowPriorityRefresh as low,
  createMetadataRefreshWorld as setup,
} from '../../../test/support/metadata-refresh-world.ts'

describe('refresh queued on a change of language or rating country (§9.4)', () => {
  test('after an identification: refreshed only when the deciding library differs', () => {
    const world = setup({
      libraries: { series: { ratingCountry: 'FR' }, movie: { ratingCountry: 'FR' } },
    })
    expect(
      world.queueRefreshIfContextDiffers({
        itemId: 'series',
        language: 'fr-FR',
        ratingCountry: 'FR',
      }),
    ).toBe(false)
    expect(
      world.queueRefreshIfContextDiffers({
        itemId: 'series',
        language: 'en-US',
        ratingCountry: 'FR',
      }),
    ).toBe(true)
    expect(
      world.queueRefreshIfContextDiffers({
        itemId: 'movie',
        language: 'fr-FR',
        ratingCountry: 'US',
      }),
    ).toBe(true)
    expect(world.refreshes()).toEqual([low('series'), low('movie')])
  })

  test('after an identification in the deciding settings: refreshed when the tree is stale', () => {
    const world = setup({
      libraries: { series: { ratingCountry: 'FR' }, other: { ratingCountry: 'FR' } },
      trees: {
        series: { ratingCountry: 'FR', stale: true },
        other: { ratingCountry: 'FR', stale: false },
      },
    })
    const written = { language: 'fr-FR', ratingCountry: 'FR' }
    expect(world.queueRefreshIfContextDiffers({ itemId: 'series', ...written })).toBe(true)
    expect(world.queueRefreshIfContextDiffers({ itemId: 'other', ...written })).toBe(false)
    expect(world.refreshes()).toEqual([low('series')])
  })
})
