import { describe, expect, test } from 'bun:test'

import type { PlaybackSessionDto } from '@projo/shared/api/playback'

import { decodeFallbackQuality } from './decode-fallback.ts'
import type { StreamFailure } from './engine.ts'

const decode: StreamFailure = { message: 'decode', kind: 'decode' }

const session = (
  overrides: Partial<Pick<PlaybackSessionDto, 'mode' | 'availableQualities'>> = {},
): Pick<PlaybackSessionDto, 'mode' | 'sourceId' | 'availableQualities'> => ({
  mode: 'hls_remux',
  sourceId: 'source-1',
  availableQualities: ['original', '1080p', '720p', '480p'],
  ...overrides,
})

const none: ReadonlySet<string> = new Set()

describe('decode fallback (§10.2)', () => {
  test('a copied stream the engine cannot decode falls back to the best quality below Original', () => {
    expect(decodeFallbackQuality({ failure: decode, session: session(), fallenBack: none })).toBe(
      '1080p',
    )
    expect(
      decodeFallbackQuality({
        failure: decode,
        session: session({ mode: 'direct', availableQualities: ['original', '480p', '720p'] }),
        fallenBack: none,
      }),
    ).toBe('720p')
  })

  test('only a decoding failure falls back', () => {
    for (const kind of ['network', 'other'] as const)
      expect(
        decodeFallbackQuality({
          failure: { message: kind, kind },
          session: session(),
          fallenBack: none,
        }),
      ).toBeUndefined()
  })

  test('never for a session already transcoded, nor without a quality below Original', () => {
    expect(
      decodeFallbackQuality({
        failure: decode,
        session: session({ mode: 'hls_transcode' }),
        fallenBack: none,
      }),
    ).toBeUndefined()
    expect(
      decodeFallbackQuality({
        failure: decode,
        session: session({ availableQualities: ['original'] }),
        fallenBack: none,
      }),
    ).toBeUndefined()
  })

  test('once per source', () => {
    expect(
      decodeFallbackQuality({
        failure: decode,
        session: session(),
        fallenBack: new Set(['source-1']),
      }),
    ).toBeUndefined()
    expect(
      decodeFallbackQuality({
        failure: decode,
        session: { ...session(), sourceId: 'source-2' },
        fallenBack: new Set(['source-1']),
      }),
    ).toBe('1080p')
  })
})
