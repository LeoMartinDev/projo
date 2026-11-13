import { describe, expect, test } from 'bun:test'

import {
  claimInput,
  created,
  createPairingsWorld as setup,
} from '../../../test/support/pairings-world.ts'
import { pairingLifetimeMs, pairingRetentionMs } from '../../core/auth/pairing.ts'

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
    expect(t.createPairing({ accountId: 'account-1', sessionId: t.creator.id })).toMatchObject({
      ok: false,
      error: { code: 'auth/pairing_limit_reached', context: { limit: 3 } },
    })
    expect(t.claimPairing({ ...claimInput, code: 'AAAAA2' }).ok).toBe(true)
    created(t)

    t.clock.advance(pairingLifetimeMs)
    created(t)

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
    expect(other.createPairing({ accountId: 'account-1', sessionId: browser.id }).ok).toBe(true)
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
