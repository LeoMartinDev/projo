import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'

import { resources } from '@projo/i18n'

import { fileName, initialFromSource, parsedSummary, reviewReason, sceneCode } from './parsed.ts'

const fr = i18next.createInstance()
await fr.init({ resources, lng: 'fr', interpolation: { escapeValue: false } })
const t = fr.t

describe('fileName', () => {
  test('last segment of a relative path', () => {
    expect(fileName('Séries/The Office/S02/The.Office.S02E03.mkv')).toBe('The.Office.S02E03.mkv')
    expect(fileName('film.mkv')).toBe('film.mkv')
  })
})

describe('sceneCode', () => {
  test('season and episode, multi-episode span, episode alone', () => {
    expect(sceneCode(2, 3)).toBe('S02E03')
    expect(sceneCode(1, 1, 2)).toBe('S01E01-E02')
    expect(sceneCode(undefined, 7)).toBe('E07')
    expect(sceneCode(3, undefined)).toBe('S03')
    expect(sceneCode(undefined, undefined)).toBeUndefined()
  })
})

describe('parsedSummary', () => {
  test('a movie: title and year', () => {
    expect(
      parsedSummary(t, { displayTitle: 'x', parsed: { title: 'Inception', year: 2010 } }),
    ).toBe('Inception · 2010')
  })

  test('an episode: series and code', () => {
    expect(
      parsedSummary(t, {
        displayTitle: 'x',
        parsed: { series: 'The Office', season: 2, episode: 3, year: 2005 },
      }),
    ).toBe('The Office · S02E03 · 2005')
  })

  test('absolute numbering and dated episodes', () => {
    expect(
      parsedSummary(t, {
        displayTitle: 'x',
        parsed: { series: 'One Piece', absoluteEpisode: 1015 },
      }),
    ).toBe('One Piece · #1015')
    expect(
      parsedSummary(t, { displayTitle: 'x', parsed: { series: 'Daily', airDate: '2024-03-01' } }),
    ).toBe('Daily · 2024-03-01')
  })

  test('the edition: an id in the interface language, a tag as written (§8.1)', () => {
    expect(
      parsedSummary(t, {
        displayTitle: 'x',
        parsed: { title: 'Blade Runner', year: 1982, edition: 'extended' },
      }),
    ).toBe('Blade Runner · 1982 · Version longue')
    expect(
      parsedSummary(t, { displayTitle: 'x', parsed: { title: 'Heat', editionName: 'Cut 4K' } }),
    ).toBe('Heat · Cut 4K')
  })

  test('nothing parsed: the display title', () => {
    expect(parsedSummary(t, { displayTitle: 'clip 01', parsed: {} })).toBe('clip 01')
  })
})

describe('reviewReason', () => {
  test('known reasons only', () => {
    expect(reviewReason('no_match')).toBe('no_match')
    expect(reviewReason('something_new')).toBeUndefined()
    expect(reviewReason(undefined)).toBeUndefined()
  })
})

describe('initialFromSource', () => {
  test('an episode prefills series, season and episode', () => {
    expect(
      initialFromSource({
        classification: 'episode',
        displayTitle: 'x',
        parsed: { series: 'The Office', season: 2, episode: 3 },
      }),
    ).toEqual({ mode: 'episode', query: 'The Office', season: 2, episode: 3 })
  })

  test('absolute numbering prefills the episode number', () => {
    expect(
      initialFromSource({
        classification: 'episode',
        displayTitle: 'x',
        parsed: { series: 'One Piece', absoluteEpisode: 1015 },
      }),
    ).toEqual({ mode: 'episode', query: 'One Piece', episode: 1015 })
  })

  test('a movie prefills title and year', () => {
    expect(
      initialFromSource({
        classification: 'movie',
        displayTitle: 'x',
        parsed: { title: 'Inception', year: 2010 },
      }),
    ).toEqual({ mode: 'movie', query: 'Inception', year: 2010 })
  })

  test('unknown with a series name reads as an episode, otherwise as a movie', () => {
    expect(
      initialFromSource({ classification: 'unknown', displayTitle: 'x', parsed: { series: 'S' } })
        .mode,
    ).toBe('episode')
    expect(
      initialFromSource({ classification: 'unknown', displayTitle: 'clip', parsed: {} }),
    ).toEqual({ mode: 'movie', query: 'clip' })
  })
})
