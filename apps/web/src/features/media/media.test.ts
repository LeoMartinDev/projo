import { describe, expect, test } from 'bun:test'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import type { ItemProgressDto } from '@projo/shared/api/progress'

import {
  canListItem,
  cardTitleOf,
  detailTargetOf,
  durationMsOf,
  episodeLabelOf,
  isWatched,
  listTargetOf,
  partialCountOf,
  posterOf,
  progressRatioOf,
  qualityLabel,
  remainingMsOf,
  resumeFrameLayout,
  wideArtOf,
  yearsLabel,
} from './media.ts'

const progress = (patch: Partial<ItemProgressDto>): ItemProgressDto => ({
  state: 'unwatched',
  watched: false,
  positionMs: 0,
  durationMs: 0,
  resumePositionMs: 0,
  playCount: 0,
  ...patch,
})

const series = {
  id: 'series',
  kind: 'series' as const,
  title: 'Severance',
  images: { poster: '/p/series', backdrop: '/b/series' },
}

const episode: ItemSummaryDto = {
  id: 'e4',
  kind: 'episode',
  title: 'Vous n’êtes pas un héros',
  sortTitle: '00004',
  genres: [],
  seasonNumber: 2,
  episodeNumber: 4,
  images: {},
  series,
  progress: progress({ state: 'in_progress', positionMs: 1_200_000, durationMs: 3_000_000 }),
}

const labels = { season: 'S', episode: 'É' }

describe('cards', () => {
  test('an episode borrows its series pictures and title', () => {
    expect(wideArtOf(episode)).toBe('/b/series')
    expect(wideArtOf({ ...episode, images: { still: '/s/e4' } })).toBe('/s/e4')
    expect(posterOf(episode)).toBe('/p/series')
    expect(cardTitleOf(episode)).toBe('Severance')
    expect(episodeLabelOf(episode, labels)).toBe('S2 · É4')
  })

  test('an item without TMDB data has no picture: the card draws its fallback', () => {
    expect(wideArtOf({ images: {} })).toBeUndefined()
    expect(posterOf({ images: {} })).toBeUndefined()
  })

  test('progress and time left only while in progress', () => {
    expect(progressRatioOf(episode)).toBeCloseTo(0.4)
    expect(remainingMsOf(episode)).toBe(1_800_000)
    expect(progressRatioOf({ progress: progress({ state: 'watched', watched: true }) })).toBe(
      undefined,
    )
    expect(remainingMsOf({})).toBeUndefined()
  })

  test('duration: probed first, TMDB runtime otherwise', () => {
    expect(durationMsOf({ durationMs: 1000, runtimeMinutes: 2 })).toBe(1000)
    expect(durationMsOf({ runtimeMinutes: 2 })).toBe(120_000)
  })

  test('watched and partial states', () => {
    expect(isWatched({ progress: progress({ watched: true, state: 'watched' }) })).toBe(true)
    const partial = {
      state: 'partial' as const,
      watchedCount: 3,
      inProgressCount: 1,
      totalCount: 9,
    }
    expect(isWatched({ watchStatus: partial })).toBe(false)
    expect(partialCountOf({ watchStatus: partial })).toEqual({ watched: 3, total: 9 })
  })

  test('episodes open their series on their season; only movies and series are listed', () => {
    expect(detailTargetOf(episode)).toEqual({ itemId: 'series', season: 2 })
    expect(detailTargetOf({ id: 'm', kind: 'movie' })).toEqual({ itemId: 'm' })
    expect(canListItem(episode)).toBe(false)
    expect(canListItem({ kind: 'series' })).toBe(true)
  })
})

test('years of a series: "2023 – 2025"', () => {
  expect(yearsLabel({ year: 2023, endYear: 2025 })).toBe('2023 – 2025')
  expect(yearsLabel({ year: 2023, endYear: 2023 })).toBe('2023')
  expect(yearsLabel({ year: 2023 })).toBe('2023')
  expect(yearsLabel({ endYear: 2025 })).toBeUndefined()
})

test('"Ma liste" on an episode card acts on its series', () => {
  expect(listTargetOf({ id: 'm', kind: 'movie', inWatchlist: true })).toEqual({
    id: 'm',
    inWatchlist: true,
  })
  expect(listTargetOf(episode)).toBeUndefined()
  expect(listTargetOf({ ...episode, series: { ...series, inWatchlist: false } })).toEqual({
    id: 'series',
    inWatchlist: false,
  })
})

test('quality badge', () => {
  expect(qualityLabel({ resolution: '2160p', dynamicRange: 'hdr' })).toBe('4K HDR')
  expect(qualityLabel({ resolution: '1080p', dynamicRange: 'sdr' })).toBe('HD')
  expect(qualityLabel({ resolution: '2160p', dynamicRange: 'dv' })).toBe('4K Dolby Vision')
  expect(qualityLabel(undefined)).toBeUndefined()
})

describe('resumeFrameLayout', () => {
  const sheet = { sheetWidth: 3200, sheetHeight: 1800 }

  test('a 16:9 frame fills the card; the sheet is shifted to its cell', () => {
    expect(resumeFrameLayout({ x: 640, y: 360, width: 320, height: 180, ...sheet })).toEqual({
      box: { left: '0%', top: '0%', width: '100%', height: '100%' },
      sheet: { left: '-200%', top: '-200%', width: '1000%', height: '1000%' },
    })
  })

  test('a wider frame overflows the card sideways, centred (cover)', () => {
    const { box } = resumeFrameLayout({ x: 0, y: 0, width: 320, height: 134, ...sheet })
    expect(box.height).toBe('100%')
    expect(box.width).toBe('134.33%')
    expect(box.left).toBe('-17.16%')
  })

  test('a narrower frame overflows the card vertically, centred', () => {
    const { box } = resumeFrameLayout({ x: 0, y: 0, width: 320, height: 240, ...sheet })
    expect(box.width).toBe('100%')
    expect(box.height).toBe('133.33%')
    expect(box.top).toBe('-16.67%')
  })
})
