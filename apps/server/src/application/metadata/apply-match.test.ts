import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import {
  createInMemoryMetadataItems,
  type FakeItem,
  tmdbEpisode,
  tmdbMovie,
  tmdbSeason,
  tmdbSeries,
} from '../../../test/support/metadata-fakes.ts'
import type { ItemOverrides } from '../../core/metadata/editing.ts'
import type { PlaybackScope } from '../../core/playback/session.ts'
import type { SourcePatch } from '../../core/source/source.ts'
import { applyMatchFactory } from './apply-match.ts'

const now = new Date('2026-03-01T12:00:00.000Z')
const readyAt = new Date('2026-02-01T08:00:00.000Z')

const setup = (
  initial: FakeItem[] = [],
  links: Record<string, string[]> = {},
  storedOverrides: Record<string, ItemOverrides> = {},
) => {
  const items = createInMemoryMetadataItems(initial, links)
  const overridesSet: { itemId: string; overrides: ItemOverrides; at: Date }[] = []
  const patches: { id: string; patch: SourcePatch }[] = []
  const ended: PlaybackScope[] = []
  const applyMatch = applyMatchFactory({
    items: items.repo,
    overrides: {
      get: (itemId) => storedOverrides[itemId] ?? {},
      set: (input) => {
        overridesSet.push(input)
      },
    },
    sourceRepository: { patch: (id, patch) => void patches.push({ id, patch }) },
    playbackSessions: { endWithin: (scope) => void ended.push(scope) },
    ids: createSequentialIds('new-'),
    clock: createManualClock(now),
  })
  return { applyMatch, items, overridesSet, patches, ended }
}

const darkResolution = (episodes = [tmdbEpisode(2)]) => ({
  kind: 'episodes' as const,
  series: tmdbSeries({
    ratings: [{ country: 'DE', rating: '16' }],
    credits: { cast: [{ tmdbId: 1, name: 'Louis Hofmann', order: 0 }], crew: [] },
  }),
  season: tmdbSeason(),
  episodes,
})

describe('applying a TMDB movie', () => {
  test('a new movie item: created, enriched, linked, added at the file readiness', () => {
    const world = setup()
    const movie = tmdbMovie({
      credits: { cast: [{ tmdbId: 6193, name: 'Leonardo DiCaprio', order: 0 }], crew: [] },
    })

    const applied = world.applyMatch.apply({
      source: { id: 's1', readyAt },
      resolution: { kind: 'movie', movie },
      language: 'fr-FR',
      ratingCountry: 'FR',
      state: 'matched',
    })

    expect(applied).toEqual({ itemIds: ['new-1'], enriched: ['new-1'], topLevelId: 'new-1' })
    expect(world.items.log.created).toEqual([
      {
        kind: 'movie',
        tmdbId: 27205,
        title: 'Inception',
        id: 'new-1',
        sortTitle: 'inception',
        createdAt: now,
      },
    ])
    expect(world.items.log.written).toHaveLength(1)
    expect(world.items.log.written[0]).toMatchObject({
      id: 'new-1',
      language: 'fr-FR',
      refreshedAt: now,
      patch: { title: 'Inception', year: 2010, genres: ['action'] },
    })
    expect(world.items.log.people).toEqual([
      {
        itemId: 'new-1',
        people: [{ tmdbId: 6193, name: 'Leonardo DiCaprio', role: 'cast', order: 0 }],
      },
    ])
    expect(world.items.links.get('s1')).toEqual(['new-1'])
    expect(world.items.log.markedAdded).toEqual([{ itemIds: ['new-1'], at: readyAt }])
    expect(world.patches).toEqual([
      {
        id: 's1',
        patch: { matchState: 'matched', reviewReason: undefined, classification: 'movie' },
      },
    ])
    expect(world.items.log.transactions).toBe(1)
  })

  test('a file not ready yet is added now', () => {
    const world = setup()
    world.applyMatch.apply({
      source: { id: 's1' },
      resolution: { kind: 'movie', movie: tmdbMovie() },
      language: 'en-US',
      ratingCountry: 'US',
      state: 'manual',
    })
    expect(world.items.log.markedAdded).toEqual([{ itemIds: ['new-1'], at: now }])
    expect(world.patches[0]?.patch.matchState).toBe('manual')
  })

  test('the movie already known by its TMDB id is reused', () => {
    const world = setup([{ id: 'm1', kind: 'movie', tmdbId: 27205 }])
    const applied = world.applyMatch.apply({
      source: { id: 's1' },
      resolution: { kind: 'movie', movie: tmdbMovie() },
      language: 'en-US',
      ratingCountry: 'US',
      state: 'matched',
    })
    expect(applied.itemIds).toEqual(['m1'])
    expect(world.items.log.created).toEqual([])
    expect(world.items.links.get('s1')).toEqual(['m1'])
  })

  test('the single local movie of the file is adopted: it gets the TMDB id, nothing moves', () => {
    const world = setup([{ id: 'local', kind: 'movie' }], { s1: ['local'] })
    const applied = world.applyMatch.apply({
      source: { id: 's1' },
      resolution: { kind: 'movie', movie: tmdbMovie() },
      language: 'en-US',
      ratingCountry: 'US',
      state: 'matched',
    })
    expect(applied.itemIds).toEqual(['local'])
    expect(world.items.log.tmdbIdsSet).toEqual([{ id: 'local', tmdbId: 27205 }])
    expect(world.items.log.created).toEqual([])
    expect(world.items.log.moved).toEqual([])
    expect(world.items.log.pruned).toEqual([])
  })

  test('a local movie joining a known TMDB movie hands its rows over, then goes', () => {
    const world = setup(
      [
        { id: 'local', kind: 'movie' },
        { id: 'm1', kind: 'movie', tmdbId: 27205 },
      ],
      { s1: ['local'] },
      { m1: { title: 'Locked title' } },
    )
    world.applyMatch.apply({
      source: { id: 's1' },
      resolution: { kind: 'movie', movie: tmdbMovie() },
      language: 'en-US',
      ratingCountry: 'US',
      state: 'matched',
    })
    expect(world.items.log.moved).toEqual([{ from: 'local', into: 'm1' }])
    expect(world.overridesSet).toEqual([
      { itemId: 'm1', overrides: { title: 'Locked title' }, at: now },
    ])
    expect(world.items.log.pruned).toEqual(['local'])
    expect(world.ended).toEqual([{ itemIds: ['local'] }])
  })

  test('locked fields are left out of the written metadata', () => {
    const world = setup([{ id: 'm1', kind: 'movie', tmdbId: 27205 }])
    world.items.locked.set('m1', new Set(['title', 'overview']))
    world.applyMatch.apply({
      source: { id: 's1' },
      resolution: { kind: 'movie', movie: tmdbMovie() },
      language: 'en-US',
      ratingCountry: 'US',
      state: 'matched',
    })
    const patch = world.items.log.written[0]?.patch ?? {}
    expect('title' in patch).toBe(false)
    expect('overview' in patch).toBe(false)
    expect(patch.year).toBe(2010)
  })

  test('the content rating of the library country is written', () => {
    const world = setup()
    world.applyMatch.apply({
      source: { id: 's1' },
      resolution: {
        kind: 'movie',
        movie: tmdbMovie({
          ratings: [
            { country: 'US', rating: 'PG-13', type: 3 },
            { country: 'FR', rating: 'TP', type: 3 },
          ],
        }),
      },
      language: 'fr-FR',
      ratingCountry: 'FR',
      state: 'matched',
    })
    expect(world.items.log.written[0]?.patch).toMatchObject({
      contentRating: 'TP',
      contentRatingCountry: 'FR',
    })
  })
})

describe('applying TMDB episodes', () => {
  test('series, season and episode created under each other; the episode inherits', () => {
    const world = setup()
    const applied = world.applyMatch.apply({
      source: { id: 's1', readyAt },
      resolution: darkResolution(),
      language: 'de-DE',
      ratingCountry: 'DE',
      state: 'manual',
    })

    expect(applied).toEqual({
      itemIds: ['new-3'],
      enriched: ['new-1', 'new-2', 'new-3'],
      topLevelId: 'new-1',
    })
    expect(
      world.items.log.created.map(
        ({ id, kind, parentId, tmdbId, seasonNumber, episodeNumber }) => ({
          id,
          kind,
          parentId,
          tmdbId,
          seasonNumber,
          episodeNumber,
        }),
      ),
    ).toEqual([
      {
        id: 'new-1',
        kind: 'series',
        parentId: undefined,
        tmdbId: 70523,
        seasonNumber: undefined,
        episodeNumber: undefined,
      },
      {
        id: 'new-2',
        kind: 'season',
        parentId: 'new-1',
        tmdbId: 900,
        seasonNumber: 1,
        episodeNumber: undefined,
      },
      {
        id: 'new-3',
        kind: 'episode',
        parentId: 'new-2',
        tmdbId: 1002,
        seasonNumber: 1,
        episodeNumber: 2,
      },
    ])
    const episodeWrite = world.items.log.written.find((w) => w.id === 'new-3')
    expect(episodeWrite?.patch).toMatchObject({
      title: 'Episode title 2',
      genres: ['drama'],
      contentRating: '16',
      contentRatingCountry: 'DE',
      originalLanguage: 'de',
    })
    expect(world.items.log.people.map((p) => p.itemId)).toEqual(['new-1'])
    expect(world.items.links.get('s1')).toEqual(['new-3'])
    expect(world.patches).toEqual([
      {
        id: 's1',
        patch: { matchState: 'manual', reviewReason: undefined, classification: 'episode' },
      },
    ])
  })

  test('a file holding two episodes is linked to both', () => {
    const world = setup()
    const applied = world.applyMatch.apply({
      source: { id: 's1' },
      resolution: darkResolution([tmdbEpisode(1), tmdbEpisode(2)]),
      language: 'en-US',
      ratingCountry: 'US',
      state: 'matched',
    })
    expect(applied.itemIds).toEqual(['new-3', 'new-4'])
    expect(world.items.links.get('s1')).toEqual(['new-3', 'new-4'])
  })

  test('known season and episode are reused; a child with another TMDB id gets the new one', () => {
    const world = setup([
      { id: 'series', kind: 'series', tmdbId: 70523 },
      { id: 'season', kind: 'season', tmdbId: 900, parentId: 'series', seasonNumber: 1 },
      {
        id: 'episode',
        kind: 'episode',
        tmdbId: 1,
        parentId: 'season',
        seasonNumber: 1,
        episodeNumber: 2,
      },
    ])
    const applied = world.applyMatch.apply({
      source: { id: 's1' },
      resolution: darkResolution(),
      language: 'en-US',
      ratingCountry: 'US',
      state: 'matched',
    })
    expect(applied).toEqual({
      itemIds: ['episode'],
      enriched: ['series', 'season', 'episode'],
      topLevelId: 'series',
    })
    expect(world.items.log.created).toEqual([])
    expect(world.items.log.tmdbIdsSet).toEqual([{ id: 'episode', tmdbId: 1002 }])
  })

  test('the local series of the file is adopted with its season and episode', () => {
    const world = setup(
      [
        { id: 'l-series', kind: 'series' },
        { id: 'l-season', kind: 'season', parentId: 'l-series', seasonNumber: 1 },
        {
          id: 'l-episode',
          kind: 'episode',
          parentId: 'l-season',
          seasonNumber: 1,
          episodeNumber: 2,
        },
      ],
      { s1: ['l-episode'] },
    )
    const applied = world.applyMatch.apply({
      source: { id: 's1' },
      resolution: darkResolution(),
      language: 'en-US',
      ratingCountry: 'US',
      state: 'matched',
    })
    expect(applied).toEqual({
      itemIds: ['l-episode'],
      enriched: ['l-series', 'l-season', 'l-episode'],
      topLevelId: 'l-series',
    })
    expect(world.items.log.tmdbIdsSet).toEqual([
      { id: 'l-series', tmdbId: 70523 },
      { id: 'l-season', tmdbId: 900 },
      { id: 'l-episode', tmdbId: 1002 },
    ])
    expect(world.items.log.created).toEqual([])
    expect(world.items.log.moved).toEqual([])
  })

  test('a local episode joining a known TMDB series moves into it with its season and series', () => {
    const world = setup(
      [
        { id: 'series', kind: 'series', tmdbId: 70523 },
        { id: 'l-series', kind: 'series' },
        { id: 'l-season', kind: 'season', parentId: 'l-series', seasonNumber: 1 },
        {
          id: 'l-episode',
          kind: 'episode',
          parentId: 'l-season',
          seasonNumber: 1,
          episodeNumber: 2,
        },
      ],
      { s1: ['l-episode'] },
    )
    world.applyMatch.apply({
      source: { id: 's1' },
      resolution: darkResolution(),
      language: 'en-US',
      ratingCountry: 'US',
      state: 'matched',
    })
    expect(world.items.log.moved).toEqual([
      { from: 'l-episode', into: 'new-2' },
      { from: 'l-season', into: 'new-1' },
      { from: 'l-series', into: 'series' },
    ])
    expect(world.items.log.pruned).toEqual(['l-episode', 'l-season', 'l-series'])
    expect(world.ended).toEqual([
      { itemIds: ['l-episode'] },
      { itemIds: ['l-season'] },
      { itemIds: ['l-series'] },
    ])
  })

  test('a TMDB episode left without file moves its rows, and its series once it has no file', () => {
    const world = setup(
      [
        { id: 'old-series', kind: 'series', tmdbId: 1 },
        { id: 'old-season', kind: 'season', tmdbId: 2, parentId: 'old-series', seasonNumber: 1 },
        {
          id: 'old-episode',
          kind: 'episode',
          tmdbId: 3,
          parentId: 'old-season',
          seasonNumber: 1,
          episodeNumber: 2,
        },
      ],
      { s1: ['old-episode'] },
    )
    world.applyMatch.apply({
      source: { id: 's1' },
      resolution: darkResolution(),
      language: 'en-US',
      ratingCountry: 'US',
      state: 'manual',
    })
    expect(world.items.log.moved).toEqual([
      { from: 'old-episode', into: 'new-3' },
      { from: 'old-season', into: 'new-2' },
      { from: 'old-series', into: 'new-1' },
    ])
    expect(world.items.log.pruned).toEqual([])
  })

  test('a TMDB episode still holding another file keeps its rows', () => {
    const world = setup(
      [
        { id: 'old-series', kind: 'series', tmdbId: 1 },
        { id: 'old-season', kind: 'season', tmdbId: 2, parentId: 'old-series', seasonNumber: 1 },
        {
          id: 'old-episode',
          kind: 'episode',
          tmdbId: 3,
          parentId: 'old-season',
          seasonNumber: 1,
          episodeNumber: 2,
        },
      ],
      { s1: ['old-episode'], s2: ['old-episode'] },
    )
    world.applyMatch.apply({
      source: { id: 's1' },
      resolution: darkResolution(),
      language: 'en-US',
      ratingCountry: 'US',
      state: 'manual',
    })
    expect(world.items.log.moved).toEqual([])
    expect(world.items.links.get('s2')).toEqual(['old-episode'])
  })
})

describe('sending a file to review', () => {
  test('marks it needs_review with the reason', () => {
    const world = setup()
    world.applyMatch.review('s1', 'episode_not_found')
    expect(world.patches).toEqual([
      { id: 's1', patch: { matchState: 'needs_review', reviewReason: 'episode_not_found' } },
    ])
  })
})
