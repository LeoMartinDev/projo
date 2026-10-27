import { describe, expect, test } from 'bun:test'

import type { PlayableSource } from '../../core/catalog/catalog.ts'
import type { TrickplayStore } from '../../core/playback/media-assets.ts'
import { resumeFramesFactory } from './resume-frames.ts'

const index = { interval: 10, width: 320, height: 180, columns: 10, rows: 10, sheets: [0, 1] }

const part = (id: string, durationMs: number, partIndex: number, stackGroupId?: string) =>
  ({
    id,
    sizeBytes: 100,
    mtime: 5,
    partIndex,
    ...(stackGroupId === undefined ? {} : { stackGroupId }),
    media: {
      durationMs,
      video: [{ index: 0, codec: 'h264', width: 1920, height: 1080 }],
      audio: [],
    },
  }) as unknown as PlayableSource

const framesFor = (sources: PlayableSource[], withSprites: readonly string[]) =>
  resumeFramesFactory({
    catalogRepository: { listReadySources: () => sources },
    trickplayStore: {
      read: (sourceId: string) =>
        withSprites.includes(sourceId)
          ? { index, fingerprint: { sizeBytes: 100, mtimeMs: 5 } }
          : undefined,
    } as unknown as TrickplayStore,
    scopeFor: () => ({}),
  })

const ask = (positionMs: number) => ({ itemId: 'movie', positionMs, profileId: 'profile' })

describe('resumeFramesFactory', () => {
  test('the thumbnail instant of the position, never past the last one', () => {
    const frames = framesFor([part('a', 3_600_000, 0)], ['a'])
    // 1234 s → thumbnail 123, at 1230 s of the file.
    expect(frames(ask(1_234_000))).toEqual({ sourceId: 'a', second: 1230 })
    expect(frames(ask(9_999_000))).toEqual({ sourceId: 'a', second: 3590 })
  })

  test('no up-to-date sprites: none', () => {
    expect(framesFor([part('a', 60_000, 0)], [])(ask(10_000))).toBeUndefined()
    const stale = { ...part('a', 60_000, 0), mtime: 6 } as PlayableSource
    expect(framesFor([stale], ['a'])(ask(10_000))).toBeUndefined()
    expect(framesFor([], ['a'])(ask(10_000))).toBeUndefined()
  })

  test('a stack of parts: the position is on the item timeline, the sprites those of the part', () => {
    const parts = [part('cd1', 600_000, 0, 'stack'), part('cd2', 600_000, 1, 'stack')]
    // 15 min = 5 min into the second part.
    expect(framesFor(parts, ['cd1', 'cd2'])(ask(900_000))).toEqual({
      sourceId: 'cd2',
      second: 300,
    })
    // The part holding the position has no sprites: nothing, not the other part's.
    expect(framesFor(parts, ['cd1'])(ask(900_000))).toBeUndefined()
  })

  test('falls back to the next version when the best one has no sprites', () => {
    const best = part('uhd', 3_600_000, 0)
    const other = part('hd', 3_600_000, 0)
    expect(framesFor([best, other], ['hd'])(ask(0))).toEqual({ sourceId: 'hd', second: 0 })
  })
})
