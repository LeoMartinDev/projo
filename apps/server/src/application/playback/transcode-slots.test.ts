import { describe, expect, test } from 'bun:test'

import type { PlaybackSession } from '../../core/playback/session.ts'
import type { TranscodeSlotHolder } from '../../core/playback/transcode-slots.ts'
import { defaultPlaybackSettings } from '../../core/settings/settings.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { transcodeSlotsFactory } from './transcode-slots.ts'

const now = new Date('2026-06-10T20:00:00.000Z')

const playing = (id: string, overrides: Partial<PlaybackSession> = {}): PlaybackSession => ({
  id,
  profileId: 'profile-1',
  authSessionId: 'auth-1',
  accountId: 'account-1',
  sourceId: 'source-1',
  itemId: 'item-1',
  mode: 'hls_transcode',
  burnIn: false,
  startedAt: now,
  lastHeartbeatAt: now,
  positionMs: 0,
  ...overrides,
})

const slotsWith = (sessions: PlaybackSession[], maxConcurrentTranscodes = 2) => {
  const slots = transcodeSlotsFactory({
    sessionRepository: { listActive: () => sessions },
    playbackSettings: { read: () => ({ ...defaultPlaybackSettings, maxConcurrentTranscodes }) },
    clock: createManualClock(now),
    logger: silentLogger,
  })
  const evicted: string[] = []
  /** A holder idle from `idleOrder` on (lower = idle longer), in use while it is undefined. */
  const holder = (id: string, idle: { order?: number } = {}): TranscodeSlotHolder => ({
    idleOrder: () => idle.order,
    evict: () => {
      evicted.push(id)
      slots.release(id)
    },
  })
  return { slots, evicted, holder }
}

describe('transcode slots of live compat streams (§29.4, §10.3)', () => {
  test('held slots count against the limit; acquiring again holds nothing more', () => {
    const { slots, holder } = slotsWith([])
    expect(slots.acquire('compat:a', holder('compat:a')).ok).toBe(true)
    expect(slots.acquire('compat:a', holder('compat:a')).ok).toBe(true)
    expect(slots.held()).toBe(1)
    expect(slots.acquire('compat:b', holder('compat:b')).ok).toBe(true)
    expect(slots.acquire('compat:c', holder('compat:c'))).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached', context: { limit: 2 } },
    })
    slots.release('compat:a')
    expect(slots.held()).toBe(1)
    expect(slots.acquire('compat:c', holder('compat:c')).ok).toBe(true)
  })

  test('playback transcodes take slots; remuxes and expired sessions do not', () => {
    const { slots, holder } = slotsWith([
      playing('transcoding'),
      playing('remuxing', { mode: 'hls_remux' }),
      playing('expired', { lastHeartbeatAt: new Date(now.getTime() - 61_000) }),
    ])
    expect(slots.acquire('compat:a', holder('compat:a')).ok).toBe(true)
    expect(slots.acquire('compat:b', holder('compat:b')).ok).toBe(false)
  })

  test('idle holders are evicted for a new one, the one idle the longest first', () => {
    const { slots, evicted, holder } = slotsWith([], 3)
    const idleB = { order: 7 }
    const idleC: { order?: number } = {}
    expect(slots.acquire('compat:a', holder('compat:a')).ok).toBe(true)
    expect(slots.acquire('compat:b', holder('compat:b', idleB)).ok).toBe(true)
    expect(slots.acquire('compat:c', holder('compat:c', idleC)).ok).toBe(true)
    idleC.order = 3
    expect(slots.acquire('compat:d', holder('compat:d')).ok).toBe(true)
    expect(evicted).toEqual(['compat:c'])
    expect(slots.acquire('compat:e', holder('compat:e')).ok).toBe(true)
    expect(evicted).toEqual(['compat:c', 'compat:b'])
    // Only holders in use are left: refused, nothing evicted.
    expect(slots.acquire('compat:f', holder('compat:f')).ok).toBe(false)
    expect(slots.held()).toBe(3)
  })

  test('a playback transcode evicts idle holders only, as many as needed', () => {
    const { slots, evicted, holder } = slotsWith([])
    slots.acquire('compat:a', holder('compat:a', { order: 1 }))
    slots.acquire('compat:b', holder('compat:b', { order: 2 }))
    expect(slots.admitPlayback(0).ok).toBe(true)
    expect(evicted).toEqual(['compat:a'])
    expect(slots.admitPlayback(1).ok).toBe(true)
    expect(evicted).toEqual(['compat:a', 'compat:b'])
    expect(slots.admitPlayback(2)).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached', context: { limit: 2 } },
    })

    const busy = slotsWith([])
    busy.slots.acquire('compat:a', busy.holder('compat:a'))
    expect(busy.slots.admitPlayback(1).ok).toBe(false)
    expect(busy.evicted).toEqual([])
  })

  test('a limit of 0 disables the compat rendition', () => {
    const { slots, holder } = slotsWith([], 0)
    expect(slots.acquire('compat:a', holder('compat:a'))).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached' },
    })
  })
})
