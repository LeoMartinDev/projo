import { describe, expect, test } from 'bun:test'

import type { EpisodeRef } from '../catalog/catalog.ts'
import type { ItemProgress } from './progress.ts'
import {
  continueWatching,
  hideFromContinue,
  nextEpisode,
  pickHero,
  type PlayedItem,
  seriesPlayTarget,
  upNext,
  upNextCandidates,
} from './rows.ts'

const day = (n: number) => new Date(Date.UTC(2026, 0, n))
const hour = 3_600_000

const progress = (
  itemId: string,
  { at = day(1), ratio = 0, watched = false, hidden = false } = {},
): ItemProgress => ({
  profileId: 'p',
  itemId,
  positionMs: Math.round(ratio * hour),
  durationMs: hour,
  watched,
  playCount: watched ? 1 : 0,
  lastPlayedAt: at,
  hiddenFromContinue: hidden,
})

const movie = (itemId: string, options: Parameters<typeof progress>[1] = {}): PlayedItem => ({
  itemId,
  kind: 'movie',
  progress: progress(itemId, options),
})

const episode = (
  itemId: string,
  seriesId: string,
  options: Parameters<typeof progress>[1] = {},
): PlayedItem => ({ itemId, kind: 'episode', seriesId, progress: progress(itemId, options) })

/** Present episodes of a series, in broadcast order: `s1e1`, `s1e2`… */
const episodes = (seriesId: string, list: [number, number, Date?][]): EpisodeRef[] =>
  list.map(([season, number, addedAt]) => ({
    id: `${seriesId}-s${season}e${number}`,
    seriesId,
    seasonNumber: season,
    episodeNumber: number,
    ...(addedAt === undefined ? {} : { addedAt }),
  }))

const none = new Set<string>()

describe('§13.1 Continuer à regarder', () => {
  test('movies and episodes between 2 % and 93 %, last played first, 20 max', () => {
    const played = [
      movie('started', { ratio: 0.01, at: day(9) }),
      movie('old', { ratio: 0.5, at: day(1) }),
      movie('finished', { ratio: 0.95, watched: true, at: day(8) }),
      episode('ep', 'show', { ratio: 0.3, at: day(5) }),
      movie('recent', { ratio: 0.92, at: day(7) }),
    ]
    expect(continueWatching({ played, hiddenSeries: none }).map((e) => e.itemId)).toEqual([
      'recent',
      'ep',
      'old',
    ])
    const many = Array.from({ length: 25 }, (_, i) =>
      movie(`m${i}`, { ratio: 0.5, at: day(i + 1) }),
    )
    expect(continueWatching({ played: many, hiddenSeries: none })).toHaveLength(20)
  })

  test('a removed movie, or an episode of a removed series, leaves the row', () => {
    const played = [
      movie('hidden', { ratio: 0.5, hidden: true }),
      episode('ep', 'show', { ratio: 0.5 }),
      movie('kept', { ratio: 0.5 }),
    ]
    expect(
      continueWatching({ played, hiddenSeries: new Set(['show']) }).map((e) => e.itemId),
    ).toEqual(['kept'])
  })

  test('"Retirer" sets the flag, on an existing row or a new one', () => {
    expect(hideFromContinue(undefined, { profileId: 'p', itemId: 'show', at: day(2) })).toEqual({
      profileId: 'p',
      itemId: 'show',
      positionMs: 0,
      durationMs: 0,
      watched: false,
      playCount: 0,
      lastPlayedAt: day(2),
      hiddenFromContinue: true,
    })
    const row = progress('m', { ratio: 0.5 })
    expect(hideFromContinue(row, { profileId: 'p', itemId: 'm', at: day(3) })).toEqual({
      ...row,
      hiddenFromContinue: true,
    })
  })
})

describe('§13.1 À suivre', () => {
  const show = episodes('show', [
    [1, 1],
    [1, 2],
    // s1e3 has no file: absent from the list, skipped.
    [1, 4],
    [2, 1],
  ])

  test('the episode after the last one watched, skipping absent episodes', () => {
    const played = [
      episode('show-s1e1', 'show', { watched: true, at: day(1) }),
      episode('show-s1e2', 'show', { watched: true, at: day(2) }),
    ]
    expect(upNext({ played, episodes: show, hiddenSeries: none })).toEqual([
      { seriesId: 'show', episode: show[2] as EpisodeRef, isNew: false, lastActivityAt: day(2) },
    ])
  })

  test('the reference is the episode watched last, not the furthest one', () => {
    const played = [
      episode('show-s1e4', 'show', { watched: true, at: day(1) }),
      episode('show-s1e1', 'show', { watched: true, at: day(3) }),
    ]
    expect(upNext({ played, episodes: show, hiddenSeries: none })[0]?.episode.id).toBe('show-s1e2')
  })

  test('a whole season marked at once: after its last episode', () => {
    const played = ['show-s1e1', 'show-s1e2', 'show-s1e4'].map((id) =>
      episode(id, 'show', { watched: true, at: day(4) }),
    )
    expect(upNext({ played, episodes: show, hiddenSeries: none })[0]?.episode.id).toBe('show-s2e1')
  })

  test('last present episode watched: the first one not watched', () => {
    const played = [episode('show-s2e1', 'show', { watched: true, at: day(4) })]
    expect(upNext({ played, episodes: show, hiddenSeries: none })[0]?.episode.id).toBe('show-s1e1')
  })

  test('leaves the row: an episode in progress, all present episodes watched, removed, never watched', () => {
    const inProgress = [
      episode('show-s1e1', 'show', { watched: true, at: day(1) }),
      episode('show-s1e2', 'show', { ratio: 0.4, at: day(2) }),
    ]
    expect(upNext({ played: inProgress, episodes: show, hiddenSeries: none })).toEqual([])
    const all = show.map((ep) => episode(ep.id, 'show', { watched: true }))
    expect(upNext({ played: all, episodes: show, hiddenSeries: none })).toEqual([])
    const watched = [episode('show-s1e1', 'show', { watched: true })]
    expect(upNext({ played: watched, episodes: show, hiddenSeries: new Set(['show']) })).toEqual([])
    // Started under 2 % then left: not "started".
    const barely = [episode('show-s1e1', 'show', { ratio: 0.01 })]
    expect(upNext({ played: barely, episodes: show, hiddenSeries: none })).toEqual([])
  })

  test('candidates: a watched episode, none in progress, not removed, in order of first play', () => {
    const played = [
      episode('b1', 'b', { watched: true }),
      movie('m', { watched: true }),
      episode('a1', 'a', { watched: true }),
      episode('busy1', 'busy', { watched: true }),
      episode('busy2', 'busy', { ratio: 0.5 }),
      episode('h1', 'hidden', { watched: true }),
      episode('n1', 'never', { ratio: 0.01 }),
      episode('b2', 'b', { watched: true }),
    ]
    const candidates = upNextCandidates(played, new Set(['hidden']))
    expect([...candidates.keys()]).toEqual(['b', 'a'])
    expect(candidates.get('b')?.map((entry) => entry.itemId)).toEqual(['b1', 'b2'])
  })

  test('a show whose watched season was deleted stays started: Up next offers the next season', () => {
    const gone = (number: number, options: Parameters<typeof progress>[1]): PlayedItem => ({
      ...episode(`kept-s1e${number}`, 'kept', options),
      seasonNumber: 1,
      episodeNumber: number,
      absent: true,
    })
    const season2 = episodes('kept', [
      [2, 1, day(10)],
      [2, 2, day(10)],
    ])
    const played = [gone(1, { watched: true, at: day(1) }), gone(2, { watched: true, at: day(2) })]
    expect(upNext({ played, episodes: season2, hiddenSeries: none })).toEqual([
      { seriesId: 'kept', episode: season2[0] as EpisodeRef, isNew: true, lastActivityAt: day(2) },
    ])
    // An episode left in progress before its file went: neither resumable nor blocking.
    const halfway = [...played, gone(3, { ratio: 0.5, at: day(3) })]
    expect(continueWatching({ played: halfway, hiddenSeries: none })).toEqual([])
    expect(upNext({ played: halfway, episodes: season2, hiddenSeries: none })).toHaveLength(1)
  })

  test('an absent episode watched last is placed by its numbers', () => {
    const present = episodes('mixed', [
      [1, 1],
      [1, 6],
      [2, 1],
    ])
    const played: PlayedItem[] = [
      episode('mixed-s2e1', 'mixed', { watched: true, at: day(1) }),
      {
        ...episode('mixed-s1e5', 'mixed', { watched: true, at: day(3) }),
        seasonNumber: 1,
        episodeNumber: 5,
        absent: true,
      },
    ]
    expect(upNext({ played, episodes: present, hiddenSeries: none })[0]?.episode.id).toBe(
      'mixed-s1e6',
    )
  })

  test('"Nouvel épisode": its file arrived after the last play on the series', () => {
    const fresh = episodes('fresh', [
      [1, 1, day(1)],
      [1, 2, day(10)],
    ])
    const played = [episode('fresh-s1e1', 'fresh', { watched: true, at: day(5) })]
    expect(upNext({ played, episodes: fresh, hiddenSeries: none })[0]).toMatchObject({
      episode: { id: 'fresh-s1e2' },
      isNew: true,
    })
    const before = [episode('fresh-s1e1', 'fresh', { watched: true, at: day(11) })]
    expect(upNext({ played: before, episodes: fresh, hiddenSeries: none })[0]?.isNew).toBe(false)
  })

  test('specials (season 0) are not proposed when the series has regular episodes', () => {
    const withSpecials = episodes('sp', [
      [0, 1],
      [1, 1],
      [1, 2],
    ])
    const played = [episode('sp-s1e2', 'sp', { watched: true })]
    // Every regular episode is not watched: s1e1 is next, not the special.
    expect(upNext({ played, episodes: withSpecials, hiddenSeries: none })[0]?.episode.id).toBe(
      'sp-s1e1',
    )
  })

  test('sorted by last activity on the series, 20 max', () => {
    const series = Array.from({ length: 22 }, (_, i) => `s${i}`)
    const played = series.map((id, i) =>
      episode(`${id}-s1e1`, id, { watched: true, at: day(i + 1) }),
    )
    const list = series.flatMap((id) =>
      episodes(id, [
        [1, 1],
        [1, 2],
      ]),
    )
    const row = upNext({ played, episodes: list, hiddenSeries: none })
    expect(row).toHaveLength(20)
    expect(row[0]?.seriesId).toBe('s21')
  })
})

describe('nextEpisode', () => {
  const list = episodes('x', [
    [1, 1],
    [1, 2],
  ])
  test('nothing watched: the first episode; all watched: none', () => {
    expect(nextEpisode(list, new Map())?.id).toBe('x-s1e1')
    expect(
      nextEpisode(
        list,
        new Map(list.map((ep) => [ep.id, progress(ep.id, { watched: true })] as const)),
      ),
    ).toBeUndefined()
  })
})

describe('nextEpisode: never an episode already watched (§13.1)', () => {
  // E1–E3 watched, E4 absent (not in the list), E5–E6 not watched.
  const list = episodes('y', [
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 5],
    [1, 6],
  ])
  const watchedUpTo3 = [
    progress('y-s1e1', { watched: true, at: day(1) }),
    progress('y-s1e2', { watched: true, at: day(2) }),
    progress('y-s1e3', { watched: true, at: day(3) }),
  ]
  const map = (...rows: ItemProgress[]) => new Map(rows.map((row) => [row.itemId, row]))

  test('E1 watched again last: the first unwatched after it, E5 (absent E4 skipped)', () => {
    const rewatched = map(...watchedUpTo3, progress('y-s1e1', { watched: true, at: day(9) }))
    expect(nextEpisode(list, rewatched)?.id).toBe('y-s1e5')
    expect(seriesPlayTarget(list, rewatched)?.episode.id).toBe('y-s1e5')
    const row = upNext({
      played: [...rewatched.values()].map((entry) => ({
        itemId: entry.itemId,
        kind: 'episode' as const,
        seriesId: 'y',
        progress: entry,
      })),
      episodes: list,
      hiddenSeries: none,
    })
    expect(row.map((entry) => entry.episode.id)).toEqual(['y-s1e5'])
  })

  test('nothing unwatched after the last one watched: the first unwatched of the series', () => {
    const lastWatched = map(
      progress('y-s1e2', { watched: true, at: day(1) }),
      progress('y-s1e6', { watched: true, at: day(5) }),
    )
    expect(nextEpisode(list, lastWatched)?.id).toBe('y-s1e1')
  })
})

describe('§13.5 Reprendre S2 · É4 / Lire', () => {
  const list = episodes('show', [
    [1, 1],
    [1, 2],
    [2, 1],
  ])
  const map = (...rows: ItemProgress[]) => new Map(rows.map((row) => [row.itemId, row]))

  test('the episode in progress played last, at its position', () => {
    expect(
      seriesPlayTarget(
        list,
        map(
          progress('show-s1e2', { ratio: 0.5, at: day(2) }),
          progress('show-s2e1', { ratio: 0.25, at: day(3) }),
        ),
      ),
    ).toEqual({ action: 'resume', episode: list[2] as EpisodeRef, positionMs: hour / 4 })
  })

  test('else the next episode, else the first one', () => {
    expect(seriesPlayTarget(list, map(progress('show-s1e1', { watched: true })))).toMatchObject({
      action: 'play',
      episode: { id: 'show-s1e2' },
      positionMs: 0,
    })
    expect(seriesPlayTarget(list, new Map())?.episode.id).toBe('show-s1e1')
    const all = map(...list.map((ep) => progress(ep.id, { watched: true })))
    expect(seriesPlayTarget(list, all)).toMatchObject({
      action: 'play',
      episode: { id: 'show-s1e1' },
    })
    expect(seriesPlayTarget([], new Map())).toBeUndefined()
  })
})

describe('§13.3 hero', () => {
  const resume = movie('m', { ratio: 0.5, at: day(5) })
  const next = {
    seriesId: 'show',
    episode: { id: 'e', seriesId: 'show' },
    isNew: false,
    lastActivityAt: day(6),
  }

  test('the most recent of "Continuer" and "À suivre"', () => {
    expect(pickHero({ continueRow: [resume], upNextRow: [next], recentlyAddedIds: ['r'] })).toEqual(
      {
        kind: 'up_next',
        entry: next,
      },
    )
    expect(
      pickHero({
        continueRow: [resume],
        upNextRow: [{ ...next, lastActivityAt: day(4) }],
        recentlyAddedIds: [],
      }),
    ).toEqual({ kind: 'continue', entry: resume })
    expect(pickHero({ continueRow: [resume], upNextRow: [], recentlyAddedIds: [] })?.kind).toBe(
      'continue',
    )
  })

  test('else the latest addition, else nothing', () => {
    expect(pickHero({ continueRow: [], upNextRow: [], recentlyAddedIds: ['r', 's'] })).toEqual({
      kind: 'recent',
      itemId: 'r',
    })
    expect(pickHero({ continueRow: [], upNextRow: [], recentlyAddedIds: [] })).toBeUndefined()
  })
})
