import { describe, expect, test } from 'bun:test'

import { type CatalogItem, type EpisodeRef, everything } from '../../../core/catalog/catalog.ts'
import type { ItemProgress, ProgressRepository } from '../../../core/progress/progress.ts'
import { seriesPlayFactory } from './series-play.ts'

const hour = 3_600_000
const scope = everything

const episode = (id: string, episodeNumber: number, durationMs?: number): CatalogItem => ({
  id,
  kind: 'episode',
  parentId: 'show-s1',
  title: id,
  sortTitle: id,
  genres: [],
  createdAt: new Date('2026-03-01T00:00:00Z'),
  seasonNumber: 1,
  episodeNumber,
  ...(durationMs === undefined ? {} : { durationMs }),
})

const progressOf = (itemId: string, positionMs: number, durationMs: number): ItemProgress => ({
  profileId: 'p1',
  itemId,
  positionMs,
  durationMs,
  watched: false,
  playCount: 0,
  lastPlayedAt: new Date('2026-03-01T20:00:00Z'),
  hiddenFromContinue: false,
})

const seriesPlayOf = (items: CatalogItem[], rows: ItemProgress[] = []) => {
  const refs: EpisodeRef[] = items.map((item) => ({
    id: item.id,
    seriesId: 'show',
    ...(item.seasonNumber === undefined ? {} : { seasonNumber: item.seasonNumber }),
    ...(item.episodeNumber === undefined ? {} : { episodeNumber: item.episodeNumber }),
  }))
  const progressRepository: ProgressRepository = {
    find: ({ itemId }) => rows.find((row) => row.itemId === itemId),
    findMany: ({ itemIds }) =>
      new Map(rows.filter((row) => itemIds.includes(row.itemId)).map((row) => [row.itemId, row])),
    save: () => undefined,
    saveMany: () => undefined,
    showAncestorsAgain: () => undefined,
  }
  return seriesPlayFactory({
    catalogReadModel: {
      findVisible: ({ id }) => items.find((item) => item.id === id),
      listSeriesEpisodes: () => refs,
    },
    progressRepository,
  })
}

describe('seriesPlay: duration of the play target', () => {
  test('resume: the duration recorded with the progress, which the position is relative to', () => {
    const play = seriesPlayOf(
      [episode('e1', 1, hour), episode('e2', 2, hour)],
      [progressOf('e2', hour / 4, hour - 1000)],
    )
    expect(play({ profileId: 'p1', seriesId: 'show', scope })).toMatchObject({
      action: 'resume',
      item: { id: 'e2' },
      positionMs: hour / 4,
      durationMs: hour - 1000,
    })
  })

  test('play: the episode duration when known', () => {
    const play = seriesPlayOf([episode('e1', 1, hour), episode('e2', 2, hour)])
    expect(play({ profileId: 'p1', seriesId: 'show', scope })).toMatchObject({
      action: 'play',
      item: { id: 'e1' },
      positionMs: 0,
      durationMs: hour,
    })
  })

  test('no duration when the episode has none', () => {
    const play = seriesPlayOf([episode('e1', 1)])
    expect(play({ profileId: 'p1', seriesId: 'show', scope })).not.toHaveProperty('durationMs')
  })
})
