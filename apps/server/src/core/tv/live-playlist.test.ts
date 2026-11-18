import { describe, expect, test } from 'bun:test'

import {
  liveTargetDurationOf,
  type LiveWindowSegment,
  parseRunPlaylist,
  renderLivePlaylist,
  servedWindow,
  windowFrom,
} from './live-playlist.ts'

const t0 = Date.parse('2026-11-18T20:00:00.000Z')

const segment = (
  run: number,
  index: number,
  sequence: number,
  durationS = 2,
  discontinuity = run - 1,
  startMs = t0 + sequence * 2000,
): LiveWindowSegment => ({
  run,
  name: `seg-${run}-${String(index).padStart(5, '0')}.m4s`,
  durationS,
  sequence,
  discontinuity,
  startMs,
  bytes: 1000,
})

describe('live playlists (§29.4)', () => {
  test('reads the segments of an ffmpeg HLS playlist', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:3',
      '#EXT-X-MEDIA-SEQUENCE:4',
      '#EXT-X-MAP:URI="init-1.mp4"',
      '#EXTINF:2.002000,',
      'seg-1-00004.m4s',
      '#EXTINF:2.960000,',
      'seg-1-00005.m4s',
      '#EXTINF:oops,',
      'seg-1-00006.m4s',
      '#EXT-X-ENDLIST',
    ].join('\r\n')
    expect(parseRunPlaylist(text)).toEqual([
      { name: 'seg-1-00004.m4s', durationS: 2.002 },
      { name: 'seg-1-00005.m4s', durationS: 2.96 },
    ])
    expect(parseRunPlaylist('')).toEqual([])
  })

  test('serves the newest segments totalling 30 s at most, the newest one at least', () => {
    const all = Array.from({ length: 20 }, (_, i) => segment(1, i, i))
    expect(servedWindow(all, 30).map((s) => s.sequence)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ])
    expect(servedWindow([segment(1, 0, 0, 45)], 30)).toHaveLength(1)
    expect(servedWindow([], 30)).toEqual([])
  })

  test('pins the target duration from the first segment, with 2 s of headroom', () => {
    expect(liveTargetDurationOf(2)).toBe(4)
    expect(liveTargetDurationOf(2.002)).toBe(4)
    expect(liveTargetDurationOf(2.6)).toBe(5)
    expect(liveTargetDurationOf(0.8)).toBe(4)
    expect(liveTargetDurationOf(5.2)).toBe(7)
  })

  test('renders a live playlist: a map and a program date per run, a discontinuity between runs', () => {
    expect(renderLivePlaylist([], 4)).toBeUndefined()
    expect(
      renderLivePlaylist(
        [
          segment(2, 7, 10, 2.5, 1),
          segment(2, 8, 11, 2, 1, t0 + 22_500),
          // The upstream was lost for 9.5 s: the next run's clock jumps.
          segment(3, 0, 12, 1.2, 2, t0 + 34_000),
        ],
        4,
      )?.split('\n'),
    ).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:4',
      '#EXT-X-MEDIA-SEQUENCE:10',
      '#EXT-X-DISCONTINUITY-SEQUENCE:1',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-START:TIME-OFFSET=-6',
      '#EXT-X-MAP:URI="init-2.mp4"',
      '#EXT-X-PROGRAM-DATE-TIME:2026-11-18T20:00:20.000Z',
      '#EXTINF:2.500,',
      'seg-2-00007.m4s',
      '#EXTINF:2.000,',
      'seg-2-00008.m4s',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-MAP:URI="init-3.mp4"',
      '#EXT-X-PROGRAM-DATE-TIME:2026-11-18T20:00:34.000Z',
      '#EXTINF:1.200,',
      'seg-3-00000.m4s',
      '',
    ])
  })

  test('serves the window from a segment on, anchored there while it lasts (§29.4)', () => {
    const window = [segment(1, 4, 4), segment(1, 5, 5), segment(1, 6, 6)]
    expect(windowFrom(window, undefined).map((s) => s.sequence)).toEqual([4, 5, 6])
    expect(windowFrom(window, 5).map((s) => s.sequence)).toEqual([5, 6])
    // Already out of the window: the whole window; past its newest: the newest alone.
    expect(windowFrom(window, 1).map((s) => s.sequence)).toEqual([4, 5, 6])
    expect(windowFrom(window, 9).map((s) => s.sequence)).toEqual([6])
    expect(windowFrom([], 3)).toEqual([])
  })

  test('a 30-minute window keeps 900 segments of 2 s', () => {
    const all = Array.from({ length: 1000 }, (_, i) => segment(1, i, i))
    const window = servedWindow(all, 30 * 60)
    expect(window).toHaveLength(900)
    expect(window[0]?.sequence).toBe(100)
  })
})
