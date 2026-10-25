import { describe, expect, test } from 'bun:test'

import { extractIdTags, normalizeTitle, prettifyTitle } from './title'

describe('normalizeTitle (comparaison, §9.2)', () => {
  test.each([
    ["Le Fabuleux Destin d'Amélie Poulain", 'le fabuleux destin damelie poulain'],
    ['Spider-Man: No Way Home', 'spider man no way home'],
    ['Fast & Furious', 'fast and furious'],
    ['  WALL·E  ', 'wall e'],
  ])('%s', (raw, expected) => {
    expect(normalizeTitle(raw)).toBe(expected)
  })
})

describe('prettifyTitle', () => {
  test.each([
    ['the.dark.knight', 'The Dark Knight'],
    ['THE DARK KNIGHT', 'The Dark Knight'],
    ['MASH', 'MASH'],
    ['S.W.A.T', 'S.W.A.T'],
    ['Mr. Robot', 'Mr. Robot'],
    ['Le_Samourai', 'Le Samourai'],
    ['Heat (', 'Heat'],
    ['Heat -', 'Heat'],
    ['GRP]', 'GRP'],
    ['The Office (US)', 'The Office (US)'],
    ['', ''],
  ])('%p → %p', (raw, expected) => {
    expect(prettifyTitle(raw)).toBe(expected)
  })
})

describe('extractIdTags', () => {
  test('plusieurs tags, le premier de chaque sorte gagne', () => {
    const { rest, ids } = extractIdTags('Film [tmdbid-1] [imdb-tt0000001] {tvdb-3} [tmdbid-2]')
    expect(rest.trim()).toBe('Film')
    expect(ids).toEqual({ tmdb: 1, imdb: 'tt0000001', tvdb: 3 })
  })

  test('sans tag', () => {
    expect(extractIdTags('Film')).toEqual({ rest: 'Film' })
  })

  test('valeurs invalides ignorées', () => {
    expect(extractIdTags('Film [tmdbid-0] [imdb-1234] [tvdb-x]').ids).toBeUndefined()
  })
})
