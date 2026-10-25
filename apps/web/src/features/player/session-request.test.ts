import { describe, expect, test } from 'bun:test'

import {
  episodeCards,
  episodeNumberLabel,
  nextEpisodeOf,
  nextInSeason,
  nextSeason,
} from './next-episode.ts'
import {
  initialRequest,
  nextRequest,
  reconnectDelay,
  retriedRequest,
  toCreateBody,
} from './session-request.ts'

const session = { sourceId: 'src-1', quality: 'original' as const }
const tracks = { audioStreamIndex: 1, subtitleTrackId: 'sub-fr', subtitlesChosen: true }

describe('nextRequest', () => {
  const request = initialRequest(false)

  test('an audio change leaves the subtitles to the cascade unless chosen in this playback', () => {
    const change = { type: 'audio' as const, index: 2 }
    const unchosen = { ...tracks, subtitlesChosen: false }
    expect(
      nextRequest({ request, session, tracks: unchosen, change, positionMs: 0 }),
    ).not.toHaveProperty('subtitleTrackId')
    expect(
      nextRequest({
        request,
        session,
        tracks: { ...unchosen, subtitleTrackId: undefined },
        change,
        positionMs: 0,
      }),
    ).not.toHaveProperty('subtitleTrackId')
    expect(
      nextRequest({
        request,
        session,
        tracks: { audioStreamIndex: 1, subtitleTrackId: undefined, subtitlesChosen: true },
        change,
        positionMs: 0,
      }),
    ).toMatchObject({ audioStreamIndex: 2, subtitleTrackId: 'off' })
  })

  test('an audio change keeps the source, the quality and the chosen subtitles', () => {
    expect(
      nextRequest({
        request,
        session,
        tracks,
        change: { type: 'audio', index: 2 },
        positionMs: 61_234.6,
      }),
    ).toEqual({
      attempt: 1,
      quality: 'original',
      startPositionMs: 61_235,
      sourceId: 'src-1',
      audioStreamIndex: 2,
      subtitleTrackId: 'sub-fr',
    })
  })

  test('subtitles off and quality changes are explicit too', () => {
    expect(
      nextRequest({
        request,
        session,
        tracks,
        change: { type: 'subtitles', trackId: 'off' },
        positionMs: 0,
      }),
    ).toMatchObject({ audioStreamIndex: 1, subtitleTrackId: 'off' })
    expect(
      nextRequest({
        request,
        session,
        tracks: { audioStreamIndex: undefined, subtitleTrackId: undefined, subtitlesChosen: false },
        change: { type: 'quality', quality: '720p' },
        positionMs: 5,
      }),
    ).toEqual({
      attempt: 1,
      quality: '720p',
      startPositionMs: 5,
      sourceId: 'src-1',
      subtitleTrackId: 'off',
    })
  })

  test('another version or part leaves the tracks to the cascade', () => {
    expect(
      nextRequest({
        request,
        session,
        tracks,
        change: { type: 'version', sourceId: 'src-4k' },
        positionMs: 10,
      }),
    ).toEqual({ attempt: 1, quality: 'original', startPositionMs: 10, sourceId: 'src-4k' })
    const part = { sourceId: 'cd2', index: 1, offsetMs: 3_000_000, durationMs: 100 }
    expect(
      nextRequest({
        request,
        session,
        tracks,
        change: { type: 'part', part },
        positionMs: 2_999_990,
      }),
    ).toEqual({ attempt: 1, quality: 'original', startPositionMs: 3_000_000, sourceId: 'cd2' })
    expect(
      nextRequest({
        request,
        session,
        tracks,
        change: { type: 'seek_part', part, positionMs: 3_500_000 },
        positionMs: 10,
      }),
    ).toMatchObject({ startPositionMs: 3_500_000, sourceId: 'cd2' })
  })

  test('a failed first request is sent again, at the position reached', () => {
    expect(retriedRequest(initialRequest(true))).toEqual({
      attempt: 1,
      quality: 'original',
      startPositionMs: 0,
    })
    expect(retriedRequest(initialRequest(false), 4200)).toMatchObject({ startPositionMs: 4200 })
  })

  test('the body leaves out what is not asked', () => {
    expect(toCreateBody('item', initialRequest(false))).toEqual({
      itemId: 'item',
      quality: 'original',
    })
  })

  test('reconnection backs off, then gives up', () => {
    expect(reconnectDelay(0)).toBe(1000)
    expect(reconnectDelay(5)).toBe(30_000)
    expect(reconnectDelay(6)).toBeUndefined()
  })
})

describe('next episode', () => {
  const episode = (id: string, episodeNumber: number) => ({ id, seasonNumber: 1, episodeNumber })
  const season = (id: string, seasonNumber: number) => ({ id, seasonNumber })

  test('the following episode of the season, whatever the list order', () => {
    const episodes = [episode('e3', 3), episode('e1', 1), episode('e2', 2)]
    expect(nextInSeason(episodes, 'e1')?.id).toBe('e2')
    expect(nextInSeason(episodes, 'e3')).toBeUndefined()
    expect(nextInSeason(episodes, 'nope')).toBeUndefined()
  })

  test('else the next season; nothing after the specials', () => {
    const seasons = [season('s2', 2), season('s0', 0), season('s1', 1)]
    expect(nextSeason(seasons, 1)?.id).toBe('s2')
    expect(nextSeason(seasons, 2)).toBeUndefined()
    expect(nextSeason(seasons, 0)).toBeUndefined()
  })

  test('combined: last of a season leads to the first of the next one', () => {
    const lists = {
      episodes: [episode('e1', 1), episode('e2', 2)],
      seasons: [season('s1', 1), season('s2', 2)],
      nextSeasonEpisodes: [episode('f2', 2), episode('f1', 1)],
    }
    expect(nextEpisodeOf({ currentId: 'e1', seasonNumber: 1, ...lists })).toEqual({
      status: 'found',
      episode: lists.episodes[1]!,
    })
    expect(nextEpisodeOf({ currentId: 'e2', seasonNumber: 1, ...lists })).toEqual({
      status: 'found',
      episode: lists.nextSeasonEpisodes[1]!,
    })
    expect(
      nextEpisodeOf({ currentId: 'e2', seasonNumber: 1, ...lists, nextSeasonEpisodes: undefined }),
    ).toEqual({ status: 'loading' })
    expect(
      nextEpisodeOf({ currentId: 'e2', seasonNumber: 2, ...lists, seasons: [season('s2', 2)] }),
    ).toEqual({ status: 'none' })
  })

  test('a multi-episode file (§8.4): one card "1-2", the next one skips what it holds', () => {
    const episodes = [
      episode('e3', 3),
      { ...episode('e1', 1), episodeNumberEnd: 2 },
      episode('e2', 2),
      { ...episode('e4', 4), episodeNumberEnd: 6 },
      episode('e5', 5),
      episode('e6', 6),
    ]
    expect(episodeCards(episodes).map((card) => card.id)).toEqual(['e1', 'e3', 'e4'])
    expect(episodeCards(episodes).map(episodeNumberLabel)).toEqual(['1-2', '3', '4-6'])
    expect(episodeNumberLabel({ id: 'x', seasonNumber: 1 })).toBeUndefined()
    expect(nextInSeason(episodes, 'e1')?.id).toBe('e3')
    // Opened on an episode another file covers too: after the whole file.
    expect(nextInSeason(episodes, 'e2')?.id).toBe('e3')
    expect(nextInSeason(episodes, 'e5')).toBeUndefined()
  })
})
