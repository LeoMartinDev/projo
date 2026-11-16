import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'

import { resources } from '@projo/i18n'
import type { SourceDto } from '@projo/shared/api/libraries'

import {
  groupKey,
  groupLabel,
  initialFromGroup,
  isSeriesGroup,
  loadingRows,
  reasonsSummary,
  showFolderPath,
} from './review-groups.ts'

const fr = i18next.createInstance()
await fr.init({ resources, lng: 'fr', interpolation: { escapeValue: false } })
const en = i18next.createInstance()
await en.init({ resources, lng: 'en', interpolation: { escapeValue: false } })

const first = {
  id: 'a',
  libraryId: 'lib',
  rootId: 'root',
  path: '/media/series/The Office/Season 2/The.Office.S02E01.mkv',
  relativePath: 'The Office/Season 2/The.Office.S02E01.mkv',
  classification: 'episode',
  displayTitle: 'The Office',
  parsed: { series: 'The Office', season: 2, episode: 1 },
} as const satisfies Partial<SourceDto>

describe('isSeriesGroup', () => {
  test('several files unfold, one file is a row of its own', () => {
    expect(isSeriesGroup({ count: 12 })).toBe(true)
    expect(isSeriesGroup({ count: 1 })).toBe(false)
  })
})

describe('groupKey', () => {
  test('a series group keeps its key when its first file changes', () => {
    const group = { id: 'a', series: 'The Office', showFolder: 'The Office', first }
    expect(groupKey(group)).toBe(groupKey({ ...group, id: 'b' }))
    expect(groupKey(group)).not.toBe(groupKey({ ...group, showFolder: 'Other/The Office' }))
  })

  test('a file of its own: its id', () => {
    expect(groupKey({ id: 'a', first })).toBe('a')
  })
})

describe('groupLabel', () => {
  test('"<show> · N files", formatted per locale', () => {
    expect(groupLabel(fr.t, 'fr', { count: 1204, series: 'The Office', first })).toBe(
      'The Office · 1 204 fichiers',
    )
    expect(groupLabel(en.t, 'en', { count: 3, series: 'The Office', first })).toBe(
      'The Office · 3 files',
    )
  })

  test('without a show name: the one read from the first file', () => {
    expect(groupLabel(en.t, 'en', { count: 2, first })).toBe('The Office · 2 files')
  })
})

describe('showFolderPath', () => {
  test('the library root, then the show folder', () => {
    expect(showFolderPath({ showFolder: 'The Office', first })).toBe('/media/series/The Office')
  })

  test('a show folder at the root of the library, a root at /', () => {
    expect(showFolderPath({ showFolder: '', first })).toBe('/media/series')
    expect(
      showFolderPath({
        showFolder: 'Show',
        first: { path: '/Show/S01/a.mkv', relativePath: 'Show/S01/a.mkv' },
      }),
    ).toBe('/Show')
  })

  test('no show folder: nothing', () => {
    expect(showFolderPath({ first })).toBeUndefined()
  })
})

describe('reasonsSummary', () => {
  test('the most frequent reason, how many others, all of them with their counts', () => {
    expect(
      reasonsSummary(fr.t, 'fr', [
        { reason: 'no_episode_number', count: 9 },
        { reason: 'episode_not_found', count: 2 },
        { reason: 'no_match', count: 1 },
      ]),
    ).toEqual({
      main: 'Pas de numéro d’épisode',
      others: 2,
      detail: 'Pas de numéro d’épisode (9), Épisode introuvable (2), Introuvable sur TMDB (1)',
    })
  })

  test('one reason, or none', () => {
    expect(reasonsSummary(en.t, 'en', [{ reason: 'no_match', count: 4 }])).toEqual({
      main: 'Not found on TMDB',
      others: 0,
      detail: 'Not found on TMDB (4)',
    })
    expect(reasonsSummary(en.t, 'en', [])).toEqual({ others: 0, detail: '' })
  })
})

describe('initialFromGroup', () => {
  test('episode mode on the first file: show, season and episode read from its name', () => {
    expect(initialFromGroup(first)).toEqual({
      mode: 'episode',
      query: 'The Office',
      season: 2,
      episode: 1,
    })
  })

  test('episode mode even when the first file was read as a movie', () => {
    expect(
      initialFromGroup({
        classification: 'movie',
        displayTitle: 'Show',
        parsed: { title: 'Show', series: 'Show', season: 1, episode: 4 },
      }),
    ).toEqual({ mode: 'episode', query: 'Show', season: 1, episode: 4 })
  })
})

describe('loadingRows', () => {
  test('one row per file, four at most', () => {
    expect(loadingRows(2)).toBe(2)
    expect(loadingRows(40)).toBe(4)
    expect(loadingRows(0)).toBe(1)
  })
})
