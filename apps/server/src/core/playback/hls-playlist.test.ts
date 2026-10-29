import { describe, expect, test } from 'bun:test'

import {
  type HlsSegment,
  nearestKeyframe,
  parseSegmentName,
  planFixedSegments,
  planSegments,
  remuxSegmentPolicy,
  renderMasterPlaylist,
  renderPlaylist,
  renderSubtitlePlaylist,
  segmentAt,
  segmentFileName,
  toHlsWebVtt,
} from './hls-playlist.ts'

const every = (step: number, durationS: number): number[] =>
  Array.from({ length: Math.ceil(durationS / step) }, (_, i) => Math.round(i * step * 1e6) / 1e6)

const bounds = (segments: HlsSegment[]) => segments.map((s) => [s.startS, s.endS])

/** Invariants of any plan: contiguous from 0 to the end, cuts on keyframes, indexes in order. */
const expectWellFormed = (segments: HlsSegment[], keyframes: number[], durationS: number) => {
  expect(segments[0]?.startS).toBe(0)
  expect(segments[segments.length - 1]?.endS).toBe(durationS)
  segments.forEach((segment, i) => {
    expect(segment.index).toBe(i)
    expect(segment.endS).toBeGreaterThan(segment.startS)
    if (i > 0) {
      expect(segment.startS).toBe(segments[i - 1]?.endS ?? -1)
      expect(keyframes).toContain(segment.startS)
    }
  })
}

describe('planSegments', () => {
  test('regular 2 s GOP: 6 s segments on keyframes', () => {
    const keyframes = every(2, 30)
    const segments = planSegments({ keyframes, durationS: 30 })
    expect(bounds(segments)).toEqual([
      [0, 6],
      [6, 12],
      [12, 18],
      [18, 24],
      [24, 30],
    ])
    expectWellFormed(segments, keyframes, 30)
  })

  test('1 s GOP (24 fps style timestamps) stays within 3–8 s', () => {
    const keyframes = every(1.001, 100)
    const durationS = 100.1
    const segments = planSegments({ keyframes, durationS })
    expectWellFormed(segments, keyframes, durationS)
    for (const segment of segments) {
      expect(segment.endS - segment.startS).toBeGreaterThanOrEqual(remuxSegmentPolicy.minS)
      expect(segment.endS - segment.startS).toBeLessThanOrEqual(remuxSegmentPolicy.maxS)
    }
  })

  test('irregular keyframes (scene cuts): the one closest to 6 s inside 3–8 s wins', () => {
    const keyframes = [0, 0.5, 3.2, 5.1, 7.9, 9.4, 10.1, 15.8, 16.4, 21, 26.5]
    const segments = planSegments({ keyframes, durationS: 30 })
    expect(bounds(segments)).toEqual([
      [0, 5.1],
      [5.1, 10.1],
      [10.1, 15.8],
      [15.8, 21],
      [21, 26.5],
      [26.5, 30],
    ])
    expectWellFormed(segments, keyframes, 30)
  })

  test('a keyframe closer than 3 s is never a cut', () => {
    const segments = planSegments({ keyframes: [0, 1, 2, 2.9, 9, 14], durationS: 20 })
    expect(bounds(segments)).toEqual([
      [0, 9],
      [9, 14],
      [14, 20],
    ])
  })

  test('long GOP (10 s keyframes): segments follow the keyframes beyond 8 s', () => {
    const keyframes = every(10, 60)
    const segments = planSegments({ keyframes, durationS: 60 })
    expect(bounds(segments)).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
      [30, 40],
      [40, 50],
      [50, 60],
    ])
  })

  test('very long first GOP then normal ones', () => {
    const keyframes = [0, 25, 27, 29, 31, 33, 35]
    const segments = planSegments({ keyframes, durationS: 40 })
    expect(bounds(segments)).toEqual([
      [0, 25],
      [25, 31],
      [31, 35],
      [35, 40],
    ])
  })

  test('a short last part is merged into the previous segment', () => {
    // 6, 12, 18 then 19 s: a cut at 18 would leave 1 s.
    const segments = planSegments({ keyframes: every(2, 19), durationS: 19 })
    expect(bounds(segments)).toEqual([
      [0, 6],
      [6, 12],
      [12, 19],
    ])
  })

  test('a short last part can make the last segment longer than 8 s', () => {
    // Keyframes every 7 s: cutting at 21 would leave a 1.5 s tail.
    const segments = planSegments({ keyframes: [0, 7, 14, 21], durationS: 22.5 })
    expect(bounds(segments)).toEqual([
      [0, 7],
      [7, 14],
      [14, 22.5],
    ])
  })

  test('short file: one segment', () => {
    expect(bounds(planSegments({ keyframes: [0, 2, 4], durationS: 5 }))).toEqual([[0, 5]])
  })

  test('no keyframe except the first: one segment for the whole file', () => {
    expect(bounds(planSegments({ keyframes: [0], durationS: 120 }))).toEqual([[0, 120]])
  })

  test('unsorted and duplicated keyframes are tolerated', () => {
    const segments = planSegments({ keyframes: [12, 6, 0, 6, 18, 24], durationS: 30 })
    expect(bounds(segments)).toEqual([
      [0, 6],
      [6, 12],
      [12, 18],
      [18, 24],
      [24, 30],
    ])
  })

  test('first keyframe after 0 (start offset): first segment still starts at 0', () => {
    const keyframes = [0.042, 2.042, 4.042, 6.042, 8.042, 10.042]
    const segments = planSegments({ keyframes, durationS: 12 })
    expect(segments[0]?.startS).toBe(0)
    expect(bounds(segments)).toEqual([
      [0, 6.042],
      [6.042, 12],
    ])
  })

  test('zero or unknown duration: no segment', () => {
    expect(planSegments({ keyframes: [0, 2], durationS: 0 })).toEqual([])
  })

  test('two hours of 2 s GOPs stays fast and well formed', () => {
    const durationS = 7200
    const keyframes = every(2.002, durationS)
    const startedAt = performance.now()
    const segments = planSegments({ keyframes, durationS })
    expect(performance.now() - startedAt).toBeLessThan(200)
    expectWellFormed(segments, keyframes, durationS)
  })
})

describe('renderPlaylist', () => {
  test('VOD fMP4 playlist, complete from the start', () => {
    const playlist = renderPlaylist([
      { index: 0, startS: 0, endS: 6.006 },
      { index: 1, startS: 6.006, endS: 14.5 },
      { index: 2, startS: 14.5, endS: 16 },
    ])
    expect(playlist).toBe(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:9',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:6.006000,',
        'seg-00000.m4s',
        '#EXTINF:8.494000,',
        'seg-00001.m4s',
        '#EXTINF:1.500000,',
        'seg-00002.m4s',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
    )
  })
})

describe('segment names and lookups', () => {
  test('names round-trip', () => {
    expect(segmentFileName(42)).toBe('seg-00042.m4s')
    expect(parseSegmentName('seg-00042.m4s')).toBe(42)
    expect(parseSegmentName('seg-123456.m4s')).toBe(123456)
    expect(parseSegmentName('init.mp4')).toBe('init')
    expect(parseSegmentName('../etc/passwd')).toBeUndefined()
    expect(parseSegmentName('seg-42.m4s')).toBeUndefined()
  })

  test('segmentAt finds the segment containing a time', () => {
    const segments = planSegments({ keyframes: every(2, 30), durationS: 30 })
    expect(segmentAt(segments, 0)).toBe(0)
    expect(segmentAt(segments, 5.99)).toBe(0)
    expect(segmentAt(segments, 6)).toBe(1)
    expect(segmentAt(segments, 29)).toBe(4)
  })

  test('nearestKeyframe', () => {
    expect(nearestKeyframe([0, 2, 4], 2.9)).toBe(1)
    expect(nearestKeyframe([0, 2, 4], 3.1)).toBe(2)
    expect(nearestKeyframe([0, 2, 4], 99)).toBe(2)
    expect(nearestKeyframe([0, 2, 4], -1)).toBe(0)
    expect(nearestKeyframe([], 1)).toBe(-1)
  })
})

describe('planFixedSegments (§10.3: 4 s segments in transcode)', () => {
  test('4 s segments from 0 to the duration, the last one shorter', () => {
    expect(bounds(planFixedSegments(10.5))).toEqual([
      [0, 4],
      [4, 8],
      [8, 10.5],
    ])
    expect(bounds(planFixedSegments(12))).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
    ])
    expect(planFixedSegments(10.5).map((segment) => segment.index)).toEqual([0, 1, 2])
  })

  test('a tail under 1 s is merged into the previous segment', () => {
    expect(bounds(planFixedSegments(8.4))).toEqual([
      [0, 4],
      [4, 8.4],
    ])
    expect(bounds(planFixedSegments(9))).toEqual([
      [0, 4],
      [4, 8],
      [8, 9],
    ])
  })

  test('short or unknown durations', () => {
    expect(bounds(planFixedSegments(0.5))).toEqual([[0, 0.5]])
    expect(planFixedSegments(0)).toEqual([])
    expect(planFixedSegments(Number.NaN)).toEqual([])
  })

  test('a 2 h film: 1800 segments, starts on multiples of 4 s, playlist target 4', () => {
    const segments = planFixedSegments(7200)
    expect(segments).toHaveLength(1800)
    expect(segments.every((segment) => segment.startS === segment.index * 4)).toBe(true)
    expect(renderPlaylist(segments)).toContain('#EXT-X-TARGETDURATION:4\n')
  })
})

describe('subtitles inside HLS (§10.4)', () => {
  const french = { id: 'fr-1', name: 'Français', language: 'fr', forced: false, sdh: false }

  test('master: one WebVTT rendition per text track, the resolved one by default', () => {
    const master = renderMasterPlaylist({
      bandwidth: 4_000_000.4,
      subtitles: [
        { ...french, selected: true },
        {
          id: 'en 2',
          name: 'English SDH',
          language: 'en',
          forced: false,
          sdh: true,
          selected: false,
        },
        { id: 'fr-f', name: 'Forcés', language: 'fr', forced: true, sdh: false, selected: false },
      ],
      subtitleOffsetMs: -250,
    })
    expect(master.split('\n')).toEqual([
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Français",LANGUAGE="fr",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="subtitles/fr-1.m3u8?subtitleOffsetMs=-250"',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English SDH",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound",URI="subtitles/en%202.m3u8?subtitleOffsetMs=-250"',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Forcés",LANGUAGE="fr",DEFAULT=NO,AUTOSELECT=YES,FORCED=YES,URI="subtitles/fr-f.m3u8?subtitleOffsetMs=-250"',
      '#EXT-X-STREAM-INF:BANDWIDTH=4000000,SUBTITLES="subs"',
      'index.m3u8',
      '',
    ])
  })

  test('master without text track: the variant alone, no subtitle group', () => {
    const master = renderMasterPlaylist({ bandwidth: 1, subtitles: [], subtitleOffsetMs: 0 })
    expect(master).toContain('#EXT-X-STREAM-INF:BANDWIDTH=1\nindex.m3u8')
    expect(master).not.toContain('SUBTITLES')
  })

  test('rendition: the whole file as one segment over the video duration', () => {
    expect(
      renderSubtitlePlaylist({ durationS: 125.5, trackId: 'fr-1', subtitleOffsetMs: 500 }),
    ).toBe(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:126',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXTINF:125.500000,',
        'fr-1.vtt?subtitleOffsetMs=500',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
    )
  })

  test('WebVTT mapped on the segments timeline (10 s = 900000 at 90 kHz); the delay moves it', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBonjour\n'
    expect(toHlsWebVtt(vtt, 0)).toBe(
      'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:01.000 --> 00:00:02.000\nBonjour\n',
    )
    expect(toHlsWebVtt(vtt, 500)).toContain('MPEGTS:945000,')
    expect(toHlsWebVtt(vtt, -10_000)).toContain('MPEGTS:0,')
  })
})
