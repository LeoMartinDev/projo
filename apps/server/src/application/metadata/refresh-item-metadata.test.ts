import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import { createMetadataRefreshWorld as setup } from '../../../test/support/metadata-refresh-world.ts'

describe('metadata language of a refresh (§9.1)', () => {
  test('fetched and recorded in the language of the deciding library', async () => {
    const world = setup({ libraries: { movie: { ratingCountry: 'FR', language: 'en-US' } } })
    expect(await world.refreshItemMetadata({ itemId: 'movie' })).toEqual(
      ok({ refreshed: ['movie'] }),
    )
    expect(world.languages).toEqual(['en-US'])
    expect(world.writes).toEqual([{ id: 'movie', language: 'en-US', contentRatingCountry: 'FR' }])
  })

  test('the server language when the deciding library has none', async () => {
    const world = setup({
      libraries: { movie: { ratingCountry: 'US' } },
      serverLanguage: 'de-DE',
    })
    await world.refreshItemMetadata({ itemId: 'movie' })
    expect(world.writes).toEqual([{ id: 'movie', language: 'de-DE', contentRatingCountry: 'US' }])
  })
})
