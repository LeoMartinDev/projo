import { describe, expect, test } from 'bun:test'

import type { SubtitleTrackDto } from '@projo/shared/api/playback'

import {
  audioSteps,
  needsTrackList,
  parseTrackList,
  subtitleSteps,
  type TrackStep,
} from './mpv-tracks.ts'

// libmpv's `track-list` of an MKV with DTS and AC-3, PGS and SRT, plus an
// external WebVTT already added (node format, trimmed).
const trackList = parseTrackList([
  { id: 1, type: 'video', 'ff-index': 0, selected: true, codec: 'hevc' },
  { id: 1, type: 'audio', 'ff-index': 1, selected: true, codec: 'dts', lang: 'eng' },
  { id: 2, type: 'audio', 'ff-index': 2, selected: false, codec: 'ac3', lang: 'fre' },
  { id: 1, type: 'sub', 'ff-index': 3, selected: false, codec: 'hdmv_pgs_subtitle' },
  { id: 2, type: 'sub', 'ff-index': 4, selected: true, codec: 'subrip' },
  {
    id: 3,
    type: 'sub',
    'ff-index': 0,
    external: true,
    'external-filename': 'http://nas:8080/api/v1/stream/s/k/subtitles/t.vtt',
    selected: false,
  },
  { type: 'sub' },
  'junk',
])

const track = (patch: Partial<SubtitleTrackDto>): SubtitleTrackDto => ({
  id: 't',
  origin: 'embedded',
  format: 'subrip',
  forced: false,
  sdh: false,
  isDefault: false,
  delivery: 'engine',
  ...patch,
})

const resolve = (url: string) => new URL(url, 'http://nas:8080/watch/x').href

describe('track-list', () => {
  test('keeps the tracks it can read', () => {
    expect(trackList.map(({ id, type }) => `${type}${id}`)).toEqual([
      'video1',
      'audio1',
      'audio2',
      'sub1',
      'sub2',
      'sub3',
    ])
    expect(trackList[5]).toMatchObject({ external: true, ffIndex: 0 })
  })
})

describe('audio by ff-index', () => {
  test('selects the session stream, once', () => {
    expect(audioSteps(trackList, 'direct', 2)).toEqual([{ kind: 'set', name: 'aid', value: '2' }])
    expect(audioSteps(trackList, 'direct', 1)).toEqual([])
  })

  test('an unknown stream, no stream, or an HLS session: libmpv keeps its track', () => {
    expect(audioSteps(trackList, 'direct', 9)).toEqual([])
    expect(audioSteps(trackList, 'direct', undefined)).toEqual([])
    expect(audioSteps(trackList, 'hls_transcode', 2)).toEqual([])
  })
})

describe('subtitles', () => {
  test('none, or a track the engine cannot show: sid=no', () => {
    const off: TrackStep[] = [{ kind: 'set', name: 'sid', value: 'no' }]
    expect(subtitleSteps(trackList, undefined, resolve)).toEqual(off)
    expect(subtitleSteps(trackList, track({ delivery: 'unsupported' }), resolve)).toEqual(off)
    expect(subtitleSteps(trackList, track({ streamIndex: 12 }), resolve)).toEqual(off)
  })

  test('an embedded track by its stream index (bitmap included)', () => {
    expect(subtitleSteps(trackList, track({ streamIndex: 3 }), resolve)).toEqual([
      { kind: 'set', name: 'sid', value: '1' },
    ])
    expect(subtitleSteps(trackList, track({ streamIndex: 4 }), resolve)).toEqual([])
  })

  test('an external WebVTT: added once, selected again later', () => {
    expect(
      subtitleSteps(
        trackList,
        track({ delivery: 'vtt', url: '/api/v1/stream/s/k/subtitles/new.vtt' }),
        resolve,
      ),
    ).toEqual([
      {
        kind: 'command',
        args: ['sub-add', 'http://nas:8080/api/v1/stream/s/k/subtitles/new.vtt', 'select'],
      },
    ])
    expect(
      subtitleSteps(
        trackList,
        track({ delivery: 'vtt', url: '/api/v1/stream/s/k/subtitles/t.vtt' }),
        resolve,
      ),
    ).toEqual([{ kind: 'set', name: 'sid', value: '3' }])
  })

  test('track-list is only read when a track must be found in it', () => {
    expect(needsTrackList(undefined)).toBe(false)
    expect(needsTrackList(track({ delivery: 'unsupported' }))).toBe(false)
    expect(needsTrackList(track({ streamIndex: 3 }))).toBe(true)
    expect(needsTrackList(track({ delivery: 'vtt', url: '/x.vtt' }))).toBe(true)
  })
})
