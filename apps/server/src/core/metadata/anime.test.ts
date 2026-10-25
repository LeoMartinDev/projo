import { describe, expect, test } from 'bun:test'

import { isAnime } from './anime.ts'

describe('isAnime (§11.1)', () => {
  test('a Japanese animated work', () => {
    expect(isAnime({ genres: ['action', 'animation'], originalLanguage: 'ja' })).toBe(true)
  })

  test('the language tag is compared on its base, whatever its case or region', () => {
    expect(isAnime({ genres: ['animation'], originalLanguage: 'ja-JP' })).toBe(true)
    expect(isAnime({ genres: ['animation'], originalLanguage: ' JA_jp ' })).toBe(true)
  })

  test('a Japanese live-action film is not an anime', () => {
    expect(isAnime({ genres: ['drama', 'crime'], originalLanguage: 'ja' })).toBe(false)
  })

  test('an animated film in another language is not an anime', () => {
    // Mars Express (2023), French.
    expect(isAnime({ genres: ['animation', 'science_fiction'], originalLanguage: 'fr' })).toBe(
      false,
    )
    expect(isAnime({ genres: ['animation'], originalLanguage: 'jav' })).toBe(false)
  })

  test('missing language or genres', () => {
    expect(isAnime({ genres: ['animation'] })).toBe(false)
    expect(isAnime({ genres: ['animation'], originalLanguage: '' })).toBe(false)
    expect(isAnime({ originalLanguage: 'ja' })).toBe(false)
    expect(isAnime({ genres: [], originalLanguage: 'ja' })).toBe(false)
    expect(isAnime({})).toBe(false)
  })
})
