import { describe, expect, test } from 'bun:test'

import {
  createCountingRateLimiter,
  createFakePairingCodes,
  createFakeSessionTokens,
  createInMemoryPairings,
  createInMemorySessions,
} from '../../../test/support/auth.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingEventBus, createSequentialIds } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import {
  normalizePairingCode,
  pairingLifetimeMs,
  pairingRetentionMs,
} from '../../core/auth/pairing.ts'
import { openSessionFactory } from './open-session.ts'
import { pairingClaimRateLimitKey, pairingsFactory } from './pairings.ts'

const setup = ({ codes = [] }: { codes?: string[] } = {}) => {
  const clock = createManualClock()
  const sessionStore = createInMemorySessions()
  const sessionRepository = sessionStore.repository
  const pairingStore = createInMemoryPairings()
  const rate = createCountingRateLimiter(10)
  const recording = createRecordingEventBus()
  const openSession = openSessionFactory({
    sessionRepository,
    sessionTokens: createFakeSessionTokens(),
    clock,
    ids: createSequentialIds('session-'),
  })
  // The web session that shows the code.
  const creator = openSession({
    accountId: 'account-1',
    kind: 'cookie',
    deviceName: 'Firefox · macOS',
    userAgent: 'Firefox',
  }).session
  return {
    clock,
    rate,
    creator,
    openSession,
    sessionRepository,
    sessions: sessionStore.sessions,
    pairings: pairingStore.pairings,
    events: recording.events,
    ...pairingsFactory({
      pairingRepository: pairingStore.repository,
      sessionRepository,
      pairingCodes: createFakePairingCodes(codes),
      openSession,
      rateLimiter: rate.limiter,
      eventBus: recording.bus,
      clock,
      ids: createSequentialIds('pairing-'),
      logger: silentLogger,
    }),
  }
}

const claimInput = { deviceName: 'iPhone 15 Pro', ip: '10.0.0.2', userAgent: 'projo/1.0 iOS' }

const created = (t: ReturnType<typeof setup>) => {
  const result = t.create({ accountId: 'account-1', sessionId: t.creator.id })
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

describe('normalizePairingCode', () => {
  test('ignores case, spaces and dashes', () => {
    expect(normalizePairingCode(' k7m 4px ')).toBe('K7M4PX')
    expect(normalizePairingCode('K7M-4PX')).toBe('K7M4PX')
  })
})

describe('create a pairing code', () => {
  test('a code valid 5 minutes, only its hash stored', () => {
    const t = setup({ codes: ['K7M4PX'] })
    const { pairing, code } = created(t)
    expect(code).toBe('K7M4PX')
    expect(pairing).toMatchObject({
      accountId: 'account-1',
      createdBySessionId: t.creator.id,
      codeHash: 'h(K7M4PX)',
    })
    expect(pairing.expiresAt.getTime() - pairing.createdAt.getTime()).toBe(pairingLifetimeMs)
    expect(JSON.stringify(t.pairings)).not.toContain('"K7M4PX"')
  })

  test('at most 3 live codes per account; an expired, claimed or voided one frees a slot', () => {
    const t = setup({ codes: ['AAAAA2', 'AAAAA3', 'AAAAA4', 'AAAAA5', 'AAAAA6'] })
    created(t)
    created(t)
    created(t)
    expect(t.create({ accountId: 'account-1', sessionId: t.creator.id })).toMatchObject({
      ok: false,
      error: { code: 'auth/pairing_limit_reached', context: { limit: 3 } },
    })
    expect(t.claim({ ...claimInput, code: 'AAAAA2' }).ok).toBe(true)
    created(t)

    t.clock.advance(pairingLifetimeMs)
    created(t)

    // Codes created from a session since revoked no longer count.
    const other = setup({ codes: ['BBBBB2', 'BBBBB3', 'BBBBB4', 'BBBBB5'] })
    created(other)
    created(other)
    created(other)
    other.sessionRepository.revoke({ id: other.creator.id, revokedAt: other.clock.now() })
    const browser = other.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'Safari · iPadOS',
      userAgent: 'Safari',
    }).session
    expect(other.create({ accountId: 'account-1', sessionId: browser.id }).ok).toBe(true)
  })

  test('a code still live elsewhere is drawn again', () => {
    const t = setup({ codes: ['CCCCC2', 'CCCCC2', 'CCCCC3'] })
    expect(created(t).code).toBe('CCCCC2')
    expect(created(t).code).toBe('CCCCC3')
  })

  test('pairings expired for a day are deleted on the next creation', () => {
    const t = setup()
    created(t)
    t.clock.advance(pairingLifetimeMs + pairingRetentionMs + 1)
    created(t)
    expect(t.pairings).toHaveLength(1)
  })
})

describe('claim a pairing code', () => {
  test('opens a bearer session of the account, once, and tells the creating session', () => {
    const t = setup({ codes: ['K7M4PX'] })
    const { pairing } = created(t)
    const result = t.claim({ ...claimInput, code: 'k7m 4px' })
    if (!result.ok) throw new Error(result.error.code)
    const { token, session } = result.value
    expect(token).toBeString()
    expect(session).toMatchObject({
      accountId: 'account-1',
      kind: 'bearer',
      deviceName: 'iPhone 15 Pro',
      userAgent: 'projo/1.0 iOS',
    })
    expect(t.pairings[0]).toMatchObject({ claimedSessionId: session.id })
    expect(t.events).toEqual([
      {
        type: 'pairing.claimed',
        payload: {
          pairingId: pairing.id,
          sessionId: t.creator.id,
          deviceSessionId: session.id,
          deviceName: 'iPhone 15 Pro',
        },
      },
    ])

    expect(t.claim({ ...claimInput, code: 'K7M4PX' })).toMatchObject({
      ok: false,
      error: { code: 'auth/pairing_used' },
    })
  })

  test('unknown, malformed, expired codes', () => {
    const t = setup({ codes: ['K7M4PX'] })
    created(t)
    for (const code of ['K7M4PY', 'K7M4P', 'O0I1AA']) {
      expect(t.claim({ ...claimInput, code })).toMatchObject({
        ok: false,
        error: { code: 'auth/pairing_invalid' },
      })
    }
    t.clock.advance(pairingLifetimeMs)
    expect(t.claim({ ...claimInput, code: 'K7M4PX' })).toMatchObject({
      ok: false,
      error: { code: 'auth/pairing_expired' },
    })
    expect(t.sessions.size).toBe(1)
  })

  test('revoking the session that created it voids the code', () => {
    const t = setup({ codes: ['K7M4PX'] })
    created(t)
    t.sessionRepository.revoke({ id: t.creator.id, revokedAt: t.clock.now() })
    expect(t.claim({ ...claimInput, code: 'K7M4PX' })).toMatchObject({
      ok: false,
      error: { code: 'auth/pairing_invalid' },
    })
  })

  test('every attempt counts against the IP; blocked at 10 with retryAfterSeconds', () => {
    const t = setup({ codes: ['K7M4PX'] })
    created(t)
    for (let attempt = 0; attempt < 10; attempt += 1) t.claim({ ...claimInput, code: 'WRONG2' })
    expect(t.rate.hits.get(pairingClaimRateLimitKey('10.0.0.2'))).toBe(10)
    expect(t.claim({ ...claimInput, code: 'K7M4PX' })).toMatchObject({
      ok: false,
      error: { code: 'auth/rate_limited', context: { retryAfterSeconds: 60 } },
    })
    expect(t.claim({ ...claimInput, ip: '10.0.0.3', code: 'K7M4PX' }).ok).toBe(true)
  })
})
