import { describe, expect, test } from 'bun:test'

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
