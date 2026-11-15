import { describe, expect, test } from 'bun:test'

import { sampleAccount } from '../../../test/support/auth.ts'
import { createAuthWorld as setup } from '../../../test/support/auth-world.ts'
import { sessionLifetimeMs } from '../../core/auth/session.ts'

const openBearer = (t: ReturnType<typeof setup>) =>
  t.openSession({ accountId: 'account-1', kind: 'bearer', deviceName: 'PC', userAgent: '' })

describe('authenticateMediaKey', () => {
  test('the key issued for a bearer session admits that session', () => {
    const t = setup()
    const { session } = openBearer(t)
    const key = t.issueMediaKey({ sessionId: session.id })
    expect(key.startsWith(`${session.id}.`)).toBe(true)
    expect(t.authenticateMediaKey(key)).toMatchObject({
      ok: true,
      value: { account: { id: 'account-1' }, session: { id: session.id, kind: 'bearer' } },
    })
  })

  test('a forged, altered or malformed key is refused', () => {
    const t = setup()
    const { session } = openBearer(t)
    const other = openBearer(t).session
    const key = t.issueMediaKey({ sessionId: session.id })
    const signature = key.slice(session.id.length + 1)
    for (const forged of [
      `${other.id}.${signature}`,
      `${session.id}.${signature}x`,
      `${session.id}.`,
      session.id,
      'garbage',
    ]) {
      expect(t.authenticateMediaKey(forged)).toMatchObject({
        ok: false,
        error: { code: 'auth/unauthenticated' },
      })
    }
  })

  test('only a bearer session has a usable key', () => {
    const t = setup()
    const { session } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    expect(t.authenticateMediaKey(t.issueMediaKey({ sessionId: session.id }))).toMatchObject({
      ok: false,
      error: { code: 'auth/unauthenticated' },
    })
  })

  test('dies with its session: revoked, expired, account disabled', () => {
    const t = setup()
    const revoked = openBearer(t).session
    t.revokeSession({ accountId: 'account-1', sessionId: revoked.id })
    expect(t.authenticateMediaKey(t.issueMediaKey({ sessionId: revoked.id }))).toMatchObject({
      ok: false,
      error: { code: 'auth/session_revoked' },
    })

    const expiring = openBearer(t).session
    t.clock.advance(sessionLifetimeMs)
    expect(t.authenticateMediaKey(t.issueMediaKey({ sessionId: expiring.id }))).toMatchObject({
      ok: false,
      error: { code: 'auth/session_expired' },
    })

    const disabled = setup({ accounts: [sampleAccount({ disabledAt: new Date(0) })] })
    const { session } = openBearer(disabled)
    expect(
      disabled.authenticateMediaKey(disabled.issueMediaKey({ sessionId: session.id })),
    ).toMatchObject({ ok: false, error: { code: 'auth/account_disabled' } })
  })
})
