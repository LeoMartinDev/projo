import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { createUuidV7Generator } from './uuid-v7.ts'

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('createUuidV7Generator', () => {
  test('produces RFC 9562 v7 identifiers carrying the timestamp', () => {
    const clock = createManualClock(new Date('2026-10-23T12:00:00.000Z'))
    const id = createUuidV7Generator({ clock }).next()
    expect(id).toMatch(uuidV7)
    const ms = Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)
    expect(ms).toBe(clock.now().getTime())
  })

  test('is strictly increasing when the clock does not move', () => {
    const ids = createUuidV7Generator({ clock: createManualClock() })
    const generated = Array.from({ length: 10_000 }, () => ids.next())
    const sorted = [...generated].sort()
    expect(generated).toEqual(sorted)
    expect(new Set(generated).size).toBe(generated.length)
  })

  test('sorts by creation time across milliseconds', () => {
    const clock = createManualClock()
    const ids = createUuidV7Generator({ clock })
    const first = ids.next()
    clock.advance(1)
    const second = ids.next()
    expect(first < second).toBe(true)
  })
})
