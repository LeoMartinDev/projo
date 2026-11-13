import { describe, expect, test } from 'bun:test'

import {
  claimInput,
  created,
  createPairingsWorld as setup,
} from '../../../test/support/pairings-world.ts'
import { normalizePairingCode, pairingLifetimeMs } from '../../core/auth/pairing.ts'
import { pairingClaimRateLimitKey } from './claim-pairing.ts'

describe('normalizePairingCode', () => {
  test('ignores case, spaces and dashes', () => {
    expect(normalizePairingCode(' k7m 4px ')).toBe('K7M4PX')
    expect(normalizePairingCode('K7M-4PX')).toBe('K7M4PX')
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
