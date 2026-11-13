import { describe, expect, test } from 'bun:test'

import {
  lowPriorityRefresh as low,
  createMetadataRefreshWorld as setup,
} from '../../../test/support/metadata-refresh-world.ts'

describe('refresh queued on a change of language or rating country (§9.4)', () => {
  test('library: its stale trees for a language, the trees it decides for a country', () => {
    const stale = { lib: ['b', 'a'] }
    const decided = { lib: ['a', 'c'] }
    const language = setup({ stale, decided })
    expect(
      language.queueLibraryContextRefresh({
        libraryId: 'lib',
        language: true,
        ratingCountry: false,
      }),
    ).toBe(2)
    expect(language.staleCalls).toEqual([{ serverLanguage: 'fr-FR', libraryId: 'lib' }])
    expect(language.refreshes()).toEqual([low('a'), low('b')])

    const country = setup({ stale, decided })
    country.queueLibraryContextRefresh({
      libraryId: 'lib',
      language: false,
      ratingCountry: true,
    })
    expect(country.staleCalls).toEqual([])
    expect(country.refreshes()).toEqual([low('a'), low('c')])

    const both = setup({ stale, decided })
    expect(
      both.queueLibraryContextRefresh({
        libraryId: 'lib',
        language: true,
        ratingCountry: true,
      }),
    ).toBe(3)
    expect(both.refreshes()).toEqual([low('a'), low('b'), low('c')])
  })
})
