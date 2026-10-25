import { describe, expect, test } from 'bun:test'

import { canReceiveEvent } from './event-audience.ts'
import {
  type Session,
  sessionLifetimeMs,
  sessionRefresh,
  sessionState,
  sessionTouchIntervalMs,
} from './session.ts'
import { describeUserAgent } from './user-agent.ts'

const hour = 3_600_000
const created = new Date('2026-03-01T00:00:00.000Z')
const session: Session = {
  id: 's1',
  accountId: 'a1',
  kind: 'cookie',
  tokenHash: 'h',
  deviceName: 'Firefox',
  userAgent: '',
  createdAt: created,
  lastSeenAt: created,
  expiresAt: new Date(created.getTime() + sessionLifetimeMs),
}
const at = (ms: number) => new Date(created.getTime() + ms)

describe('sessionState', () => {
  test('active, expired, revoked', () => {
    expect(sessionState(session, at(hour))).toBe('active')
    expect(sessionState(session, at(sessionLifetimeMs))).toBe('expired')
    expect(sessionState({ ...session, revokedAt: at(1) }, at(hour))).toBe('revoked')
  })
})

describe('sessionRefresh (30 days sliding, §14)', () => {
  test('nothing to write right after the last activity', () => {
    expect(sessionRefresh(session, at(sessionTouchIntervalMs - 1))).toBeUndefined()
  })

  test('refreshes last activity without renewing within 24 h', () => {
    const refresh = sessionRefresh(session, at(2 * hour))
    expect(refresh).toEqual({
      lastSeenAt: at(2 * hour),
      expiresAt: session.expiresAt,
      renewed: false,
    })
  })

  test('renews the expiry when the previous renewal is 24 h old', () => {
    const refresh = sessionRefresh(session, at(25 * hour))
    expect(refresh).toEqual({
      lastSeenAt: at(25 * hour),
      expiresAt: at(25 * hour + sessionLifetimeMs),
      renewed: true,
    })
  })
})

describe('canReceiveEvent', () => {
  const admin = { admin: true, sessionId: session.id }
  const user = { admin: false, sessionId: 's2' }
  const scan = {
    type: 'scan.progress' as const,
    payload: {
      libraryId: 'l',
      scanRunId: 'r',
      stats: { discovered: 1, pending: 0, ready: 1, missing: 0, errors: 0, seen: 1, moved: 0 },
      phase: 'discovering' as const,
    },
  }
  const ready = { type: 'source.ready' as const, payload: { sourceId: 's', libraryId: 'l' } }
  const terminated = {
    type: 'playback.session_terminated' as const,
    payload: { playbackSessionId: 'p', sessionId: 's2', reason: 'admin' as const },
  }

  test('admin events reach admins only', () => {
    expect(canReceiveEvent(scan, admin)).toBe(true)
    expect(canReceiveEvent(scan, user)).toBe(false)
  })

  test('source.ready reaches admins only (it names libraries and sources)', () => {
    expect(canReceiveEvent(ready, admin)).toBe(true)
    expect(canReceiveEvent(ready, user)).toBe(false)
  })

  test('owning_session events reach that session only, even for admins', () => {
    expect(canReceiveEvent(terminated, user)).toBe(true)
    expect(canReceiveEvent(terminated, admin)).toBe(false)
  })
})

describe('describeUserAgent', () => {
  test.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Firefox · macOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      'Edge · Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari · iOS',
    ],
    ['curl/8.0', 'Unknown device'],
  ])('%s', (userAgent, expected) => {
    expect(describeUserAgent(userAgent)).toBe(expected)
  })
})
