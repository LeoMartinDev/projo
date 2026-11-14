import { describe, expect, test } from 'bun:test'

import { hlsFailureKind, mediaErrorKind } from './failure-kind.ts'

describe('stream failure kinds', () => {
  test('<video> errors: network, decode or unsupported source, anything else', () => {
    expect(mediaErrorKind(2)).toBe('network')
    expect(mediaErrorKind(3)).toBe('decode')
    expect(mediaErrorKind(4)).toBe('decode')
    expect(mediaErrorKind(1)).toBe('other')
    expect(mediaErrorKind(undefined)).toBe('other')
  })

  test('hls.js fatal errors: network, media or mux, anything else', () => {
    expect(hlsFailureKind('networkError')).toBe('network')
    expect(hlsFailureKind('mediaError')).toBe('decode')
    expect(hlsFailureKind('muxError')).toBe('decode')
    expect(hlsFailureKind('keySystemError')).toBe('other')
    expect(hlsFailureKind('otherError')).toBe('other')
  })
})
