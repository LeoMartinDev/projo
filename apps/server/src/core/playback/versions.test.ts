import { describe, expect, test } from 'bun:test'

import type { PlayableSource } from '../catalog/catalog.ts'
import {
  groupVersions,
  partAt,
  partsTimeline,
  rankVersions,
  totalDurationMs,
  versionOf,
} from './versions.ts'

const source = (
  id: string,
  {
    width,
    height,
    dynamicRange,
    ...extra
  }: Partial<PlayableSource> & {
    width?: number
    height?: number
    dynamicRange?: 'sdr' | 'hdr' | 'dv'
  } = {},
): PlayableSource => ({
  id,
  state: 'ready',
  libraryId: 'library-1',
  path: `/media/${id}.mkv`,
  rootReachable: true,
  extension: 'mkv',
  sizeBytes: 1,
  mtime: 1,
  version: {},
  media: {
    durationMs: 1000,
    video: [
      {
        index: 0,
        codec: 'h264',
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        ...(dynamicRange === undefined ? {} : { dynamicRange }),
      },
    ],
    audio: [],
    subtitles: [],
  },
  ...extra,
})

describe('groupVersions (§7.7)', () => {
  test('one version per source, the parts of a stack together in part order', () => {
    const versions = groupVersions([
      source('cd2', { stackGroupId: 'stack', partIndex: 2 }),
      source('single'),
      source('cd1', { stackGroupId: 'stack', partIndex: 1 }),
    ])
    expect(versions.map((version) => [version.key, version.parts.map((p) => p.id)])).toEqual([
      ['stack', ['cd1', 'cd2']],
      ['single', ['single']],
    ])
    expect(versionOf(versions, 'cd2')?.key).toBe('stack')
    expect(versionOf(versions, 'unknown')).toBeUndefined()
  })
})

const { media: _media, ...unprobed } = source('unprobed')

describe('rankVersions', () => {
  test('resolution, then dynamic range, then size; unknown probe last', () => {
    const ranked = rankVersions(
      groupVersions([
        unprobed,
        source('hd', { width: 1920, height: 1080, sizeBytes: 9 }),
        source('uhd-sdr', { width: 3840, height: 2160 }),
        source('uhd-hdr', { width: 3840, height: 2160, dynamicRange: 'hdr' }),
        source('hd-small', { width: 1920, height: 1080, sizeBytes: 2 }),
      ]),
    )
    expect(ranked.map((version) => version.key)).toEqual([
      'uhd-hdr',
      'uhd-sdr',
      'hd',
      'hd-small',
      'unprobed',
    ])
  })

  test('a stack is weighed by its first part and its total size', () => {
    const ranked = rankVersions(
      groupVersions([
        source('big', { width: 1920, height: 1080, sizeBytes: 5 }),
        source('cd1', { width: 1920, height: 1080, sizeBytes: 3, stackGroupId: 's', partIndex: 1 }),
        source('cd2', { width: 1920, height: 1080, sizeBytes: 3, stackGroupId: 's', partIndex: 2 }),
      ]),
    )
    expect(ranked.map((version) => version.key)).toEqual(['s', 'big'])
  })
})

describe('parts timeline (§8.4)', () => {
  const timeline = partsTimeline([
    { sourceId: 'cd1', durationMs: 1000 },
    { sourceId: 'cd2', durationMs: 2000 },
    { sourceId: 'cd3', durationMs: 500 },
  ])

  test('cumulative offsets', () => {
    expect(timeline).toEqual([
      { sourceId: 'cd1', index: 0, offsetMs: 0, durationMs: 1000 },
      { sourceId: 'cd2', index: 1, offsetMs: 1000, durationMs: 2000 },
      { sourceId: 'cd3', index: 2, offsetMs: 3000, durationMs: 500 },
    ])
    expect(totalDurationMs(timeline)).toBe(3500)
  })

  test('the part containing a position; a part starts at its offset; past the end: the last', () => {
    expect(
      [0, 999, 1000, 2999, 3000, 3499, 9999].map((at) => partAt(timeline, at).sourceId),
    ).toEqual(['cd1', 'cd1', 'cd2', 'cd2', 'cd3', 'cd3', 'cd3'])
  })

  test('a single part of unknown duration is played whatever the position', () => {
    expect(partAt(partsTimeline([{ sourceId: 'only', durationMs: 0 }]), 5000).sourceId).toBe('only')
  })
})
