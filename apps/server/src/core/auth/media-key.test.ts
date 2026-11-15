import { describe, expect, test } from 'bun:test'

import { formatMediaKey, mediaKeyMessage, parseMediaKey } from './media-key.ts'

describe('media key', () => {
  test('signs "media:" + the session id', () => {
    expect(mediaKeyMessage('0190c0de-0000-7000-8000-000000000001')).toBe(
      'media:0190c0de-0000-7000-8000-000000000001',
    )
  })

  test('<sessionId>.<signature>, read back as written', () => {
    const key = formatMediaKey({ sessionId: 'session-1', signature: 'c2lnbmF0dXJl' })
    expect(key).toBe('session-1.c2lnbmF0dXJl')
    expect(parseMediaKey(key)).toEqual({ sessionId: 'session-1', signature: 'c2lnbmF0dXJl' })
  })

  test('anything else is not a key', () => {
    for (const key of ['', 'session-1', 'session-1.', '.sig', 'a.b.c', `s.${'x'.repeat(300)}`]) {
      expect(parseMediaKey(key)).toBeUndefined()
    }
  })
})
