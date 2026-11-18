import { describe, expect, test } from 'bun:test'

import { acceptsGzip } from './tv.ts'

describe('the live playlist is gzipped when the request accepts it (§29.4)', () => {
  test('gzip listed, with or without a weight above 0', () => {
    expect(acceptsGzip('gzip, deflate, br')).toBe(true)
    expect(acceptsGzip('br;q=1.0, GZIP;q=0.5')).toBe(true)
    expect(acceptsGzip('gzip ; q=1')).toBe(true)
  })

  test('absent, or refused by a weight of 0 however it is written', () => {
    expect(acceptsGzip(undefined)).toBe(false)
    expect(acceptsGzip('deflate, br')).toBe(false)
    expect(acceptsGzip('x-gzip')).toBe(false)
    expect(acceptsGzip('gzip;q=0')).toBe(false)
    expect(acceptsGzip('gzip;q=0.0, deflate')).toBe(false)
    expect(acceptsGzip('gzip; q=0.000')).toBe(false)
  })
})
