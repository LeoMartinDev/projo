import { describe, expect, test } from 'bun:test'

import { createAuthWorld as setup } from '../../../test/support/auth-world.ts'

describe('sessions', () => {
  test('lists active sessions of the account and revokes only its own', () => {
    const t = setup()
    const mine = t.openSession({
      accountId: 'account-1',
      kind: 'cookie',
      deviceName: 'a',
      userAgent: '',
    })
    const other = t.openSession({
      accountId: 'account-2',
      kind: 'cookie',
      deviceName: 'b',
      userAgent: '',
    })
    expect(t.listSessions({ accountId: 'account-1' }).map((s) => s.id)).toEqual([mine.session.id])

    expect(t.revokeSession({ accountId: 'account-1', sessionId: other.session.id })).toMatchObject({
      ok: false,
      error: { code: 'auth/session_not_found' },
    })
    expect(t.revokeSession({ accountId: 'account-1', sessionId: mine.session.id }).ok).toBe(true)
    expect(t.listSessions({ accountId: 'account-1' })).toEqual([])
  })
})
