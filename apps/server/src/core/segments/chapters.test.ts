import { describe, expect, test } from 'bun:test'

import type { PlayableSource } from '../catalog/catalog.ts'
import { chapterSegments, chapterType, itemTimeline } from './chapters.ts'

describe('chapterType (§12.2 row 2)', () => {
  test.each([
    ['Intro', 'intro'],
    ['INTRO', 'intro'],
    ['Opening', 'intro'],
    ['Opening Credits', 'intro'],
    ['Opening Theme', 'intro'],
    ['OP', 'intro'],
    ['op1', 'intro'],
    ['OP 2', 'intro'],
    ['OP - Unravel', 'intro'],
    ['Ending', 'credits'],
    ['ED', 'credits'],
    ['ED2', 'credits'],
    ['Credits', 'credits'],
    ['End Credits', 'credits'],
    ['Closing credits', 'credits'],
    ['Outro', 'credits'],
    ['Recap', 'recap'],
    ['Previously on', 'recap'],
    ['Preview', 'preview'],
    ['Next Episode Preview', 'preview'],
  ] as const)('%p → %p', (title, type) => {
    expect(chapterType(title)).toBe(type)
  })

  test.each([
    'Chapter 1',
    'Chapitre 01',
    'Part A',
    'Prologue',
    'Mid-credits scene',
    'Post-Credits',
    'Edward arrives',
    'Operation Overlord',
    'The Opening of the Gates',
    'A Happy Ending for Everyone',
    '',
  ])('%p → nothing', (title) => {
    expect(chapterType(title)).toBeUndefined()
  })

  test('no title, no type', () => {
    expect(chapterType(undefined)).toBeUndefined()
  })
})

describe('chapterSegments', () => {
  test('one candidate per type; intro first run, credits last run', () => {
    const segments = chapterSegments(
      [
        { startMs: 0, endMs: 60_000, title: 'Recap' },
        { startMs: 60_000, endMs: 150_000, title: 'OP' },
        { startMs: 150_000, endMs: 1_200_000, title: 'Part A' },
        { startMs: 1_200_000, endMs: 1_290_000, title: 'ED' },
        { startMs: 1_290_000, endMs: 1_320_000, title: 'Preview' },
      ],
      1_320_000,
    )
    expect(segments).toEqual([
      { type: 'intro', startMs: 60_000, endMs: 150_000 },
      { type: 'recap', startMs: 0, endMs: 60_000 },
      { type: 'credits', startMs: 1_200_000, endMs: 1_290_000 },
      { type: 'preview', startMs: 1_290_000, endMs: 1_320_000 },
    ])
  })

  test('contiguous chapters of a type merge ("Ending" then "Credits")', () => {
    expect(
      chapterSegments([
        { startMs: 0, endMs: 5_000_000, title: 'Chapter 1' },
        { startMs: 5_000_500, endMs: 5_100_000, title: 'Ending' },
        { startMs: 5_100_000, endMs: 5_400_000, title: 'Credits' },
      ]),
    ).toEqual([{ type: 'credits', startMs: 5_000_500, endMs: 5_400_000 }])
  })

  test('end clamped to the duration; empty runs dropped', () => {
    expect(
      chapterSegments(
        [
          { startMs: 0, endMs: 0, title: 'Intro' },
          { startMs: 5_000_000, endMs: 9_000_000, title: 'Credits' },
        ],
        5_400_000,
      ),
    ).toEqual([{ type: 'credits', startMs: 5_000_000, endMs: 5_400_000 }])
  })
})

const source = (id: string, extra: Partial<PlayableSource>): PlayableSource => ({
  id,
  state: 'ready',
  libraryId: 'l',
  path: `/m/${id}.mkv`,
  rootReachable: true,
  extension: 'mkv',
  sizeBytes: 1,
  mtime: 1,
  version: {},
  ...extra,
})

describe('itemTimeline (§7.7 stacks)', () => {
  test('chapters of each part shifted by the parts before', () => {
    const media = (durationMs: number, title: string, startMs: number, endMs: number) => ({
      durationMs,
      video: [{ index: 0, codec: 'h264' }],
      audio: [],
      subtitles: [],
      chapters: [{ startMs, endMs, title }],
    })
    const timeline = itemTimeline([
      source('part2', {
        stackGroupId: 'g',
        partIndex: 2,
        media: media(3_000_000, 'Credits', 2_700_000, 3_000_000),
      }),
      source('part1', {
        stackGroupId: 'g',
        partIndex: 1,
        media: media(3_600_000, 'Opening', 0, 120_000),
      }),
    ])
    expect(timeline).toEqual({
      durationMs: 6_600_000,
      chapters: [
        { startMs: 0, endMs: 120_000, title: 'Opening' },
        { startMs: 6_300_000, endMs: 6_600_000, title: 'Credits' },
      ],
    })
  })

  test('no ready source: nothing known', () => {
    expect(itemTimeline([])).toEqual({ chapters: [] })
  })

  test('unknown duration: no total', () => {
    expect(itemTimeline([source('a', {})])).toEqual({ chapters: [] })
  })
})
