import { describe, expect, test } from 'bun:test'

import { sampleAccount } from '../../../test/support/auth.ts'
import { createAuthWorld as setup } from '../../../test/support/auth-world.ts'
import { sessionLifetimeMs } from '../../core/auth/session.ts'

describe('authenticate', () => {
  test('resolves a token of the right kind only', () => {
    const t = setup()
    const { token } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    expect(t.authenticate({ token, kind: 'cookie' })).toMatchObject({
      ok: true,
      value: { account: { id: 'account-1', username: 'Leo', role: 'admin' }, renewed: false },
    })
    expect(t.authenticate({ token, kind: 'bearer' })).toMatchObject({
      ok: false,
      error: { code: 'auth/unauthenticated' },
    })
    expect(t.authenticate({ token: 'forged', kind: 'cookie' })).toMatchObject({
      ok: false,
      error: { code: 'auth/unauthenticated' },
    })
  })

  test('slides the expiry after 24 h, expires after 30 idle days', () => {
    const t = setup()
    const { token, session } = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    t.clock.advance(25 * 3_600_000)
    const renewed = t.authenticate({ token, kind: 'cookie' })
    expect(renewed).toMatchObject({ ok: true, value: { renewed: true } })
    expect(t.sessions.get(session.id)?.expiresAt).toEqual(
      new Date(t.clock.now().getTime() + sessionLifetimeMs),
    )

    t.clock.advance(sessionLifetimeMs)
    expect(t.authenticate({ token, kind: 'cookie' })).toMatchObject({
      ok: false,
      error: { code: 'auth/session_expired' },
    })
  })

  test('revoked sessions and disabled accounts are refused', () => {
    const t = setup()
    const { token, session } = t.openSession({
      accountId: 'account-1',
      kind: 'bearer',
      deviceName: 'd',
      userAgent: '',
    })
    t.sessionRepository.revoke({ id: session.id, revokedAt: t.clock.now() })
    expect(t.authenticate({ token, kind: 'bearer' })).toMatchObject({
      ok: false,
      error: { code: 'auth/session_revoked' },
    })

    const disabled = setup({ accounts: [sampleAccount({ disabledAt: new Date(0) })] })
    const opened = disabled.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'd',
      userAgent: '',
    })
    expect(disabled.authenticate({ token: opened.token, kind: 'cookie' })).toMatchObject({
      ok: false,
      error: { code: 'auth/account_disabled' },
    })
  })
})
