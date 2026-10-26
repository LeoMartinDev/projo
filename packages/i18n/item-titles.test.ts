import { describe, expect, test } from 'bun:test'
import i18next, { type TFunction } from 'i18next'

import { resources } from './index.ts'
import {
  chapterLabel,
  episodeCode,
  episodeLine,
  itemTitle,
  itemWithSeriesLabel,
  listedNumber,
  playEpisodeLabel,
} from './item-titles.ts'

const translator = async (lng: 'fr' | 'en'): Promise<TFunction> => {
  const instance = i18next.createInstance()
  await instance.init({ resources, lng, interpolation: { escapeValue: false } })
  return instance.t
}

describe('labels of untitled seasons and episodes (§6.3)', () => {
  test('an episode without a title is labelled from its number, in the interface language', async () => {
    const episode = { kind: 'episode', episodeNumber: 7 } as const
    expect(itemTitle(await translator('fr'), episode)).toBe('Épisode 7')
    expect(itemTitle(await translator('en'), episode)).toBe('Episode 7')
  })

  test('a season without a title: "Saison 1", specials for season 0', async () => {
    const fr = await translator('fr')
    const en = await translator('en')
    expect(itemTitle(fr, { kind: 'season', seasonNumber: 1 })).toBe('Saison 1')
    expect(itemTitle(en, { kind: 'season', seasonNumber: 1 })).toBe('Season 1')
    expect(itemTitle(fr, { kind: 'season', seasonNumber: 0 })).toBe('Épisodes spéciaux')
    expect(itemTitle(en, { kind: 'season', seasonNumber: 0 })).toBe('Specials')
  })

  test('a title of its own is shown as is', async () => {
    const fr = await translator('fr')
    expect(itemTitle(fr, { kind: 'episode', episodeNumber: 7, title: 'The Watcher' })).toBe(
      'The Watcher',
    )
    expect(itemTitle(fr, { kind: 'season', seasonNumber: 1, title: 'Book One: Water' })).toBe(
      'Book One: Water',
    )
    expect(itemTitle(fr, { kind: 'movie', title: 'Inception' })).toBe('Inception')
  })

  test('chapters without a name are numbered from 1', async () => {
    expect(chapterLabel(await translator('fr'), {}, 2)).toBe('Chapitre 3')
    expect(chapterLabel(await translator('en'), {}, 0)).toBe('Chapter 1')
    expect(chapterLabel(await translator('fr'), { title: 'Générique' }, 0)).toBe('Générique')
  })
})

describe('items named with their series (admin lists)', () => {
  test('an episode: its series and its code, in the interface language', async () => {
    const episode = {
      kind: 'episode',
      title: 'Goodbye',
      seriesTitle: 'Severance',
      seasonNumber: 2,
      episodeNumber: 4,
    } as const
    expect(itemWithSeriesLabel(await translator('fr'), episode)).toBe('Severance · S2 · É4')
    expect(itemWithSeriesLabel(await translator('en'), episode)).toBe('Severance · S2 · E4')
  })

  test('an untitled episode reads the same; without its series, its number', async () => {
    const fr = await translator('fr')
    const en = await translator('en')
    const untitled = {
      kind: 'episode',
      seriesTitle: 'Severance',
      seasonNumber: 2,
      episodeNumber: 5,
    } as const
    expect(itemWithSeriesLabel(fr, untitled)).toBe('Severance · S2 · É5')
    expect(itemWithSeriesLabel(fr, { kind: 'episode', seasonNumber: 1, title: 'Pilot' })).toBe(
      'S1 · Pilot',
    )
    expect(itemWithSeriesLabel(en, { kind: 'episode', episodeNumber: 7 })).toBe('E7')
    expect(itemWithSeriesLabel(en, { kind: 'episode' })).toBe('')
  })

  test('a season: its series and its own title or number', async () => {
    const fr = await translator('fr')
    const en = await translator('en')
    const season = { kind: 'season', seriesTitle: 'Severance', seasonNumber: 2 } as const
    expect(itemWithSeriesLabel(fr, season)).toBe('Severance · Saison 2')
    expect(itemWithSeriesLabel(en, season)).toBe('Severance · Season 2')
    expect(itemWithSeriesLabel(en, { ...season, seasonNumber: 0 })).toBe('Severance · Specials')
    expect(itemWithSeriesLabel(fr, { ...season, title: 'Book One: Water' })).toBe(
      'Severance · Book One: Water',
    )
  })

  test('a movie or a series: its title', async () => {
    const fr = await translator('fr')
    expect(itemWithSeriesLabel(fr, { kind: 'movie', title: 'Dune' })).toBe('Dune')
    expect(itemWithSeriesLabel(fr, { kind: 'series', title: 'Severance' })).toBe('Severance')
  })
})

describe('episodes on lines that show their number (§6.3)', () => {
  const titled = {
    kind: 'episode',
    title: 'The Watcher',
    seasonNumber: 1,
    episodeNumber: 7,
  } as const
  const untitled = { kind: 'episode', seasonNumber: 1, episodeNumber: 7 } as const

  test('a titled episode: its code and its title', async () => {
    const fr = await translator('fr')
    const en = await translator('en')
    expect(episodeLine(fr, titled)).toBe('S1 · É7 « The Watcher »')
    expect(episodeLine(en, titled)).toBe('S1 · E7 “The Watcher”')
    expect(episodeLine(fr, titled, 'dotted')).toBe('S1 · É7 · The Watcher')
    expect(episodeLine(en, titled, 'dotted')).toBe('S1 · E7 · The Watcher')
  })

  test('an untitled episode: its code only, the number is not repeated', async () => {
    const fr = await translator('fr')
    const en = await translator('en')
    expect(episodeLine(fr, untitled)).toBe('S1 · É7')
    expect(episodeLine(en, untitled)).toBe('S1 · E7')
    expect(episodeLine(fr, untitled, 'dotted')).toBe('S1 · É7')
    expect(episodeLine(en, untitled, 'dotted')).toBe('S1 · E7')
  })

  test('without a code: its title, or nothing', async () => {
    const fr = await translator('fr')
    expect(episodeLine(fr, { kind: 'episode', title: 'Pilot' })).toBe('Pilot')
    expect(episodeLine(fr, { kind: 'episode' })).toBe('')
  })

  test('in a list, the number before the name only when the name is not built from it', () => {
    expect(listedNumber(titled, '7')).toBe('7')
    expect(listedNumber(untitled, '7')).toBeUndefined()
    expect(listedNumber({ ...untitled, episodeNumberEnd: 8 }, '7-8')).toBe('7-8')
  })

  test('the play button of an episode row names its number once', async () => {
    const fr = await translator('fr')
    const en = await translator('en')
    expect(playEpisodeLabel(fr, titled, '7')).toBe('Lire l’épisode 7, « The Watcher »')
    expect(playEpisodeLabel(en, titled, '7')).toBe('Play episode 7, “The Watcher”')
    expect(playEpisodeLabel(fr, untitled, '7')).toBe('Lire l’épisode 7')
    expect(playEpisodeLabel(en, untitled, '7')).toBe('Play episode 7')
  })
})

describe('episodeCode', () => {
  test('season and episode', () => {
    expect(episodeCode(2, 4, { season: 'S', episode: 'É' })).toBe('S2 · É4')
  })

  test('season only', () => {
    expect(episodeCode(1, undefined, { season: 'S', episode: 'E' })).toBe('S1')
  })
})
