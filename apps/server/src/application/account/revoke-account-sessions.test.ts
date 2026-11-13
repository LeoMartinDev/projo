import { describe, expect, test } from 'bun:test'

import {
  createAdminAccountsWorld as setup,
  revokedIds,
} from '../../../test/support/admin-accounts-world.ts'

describe('admin accounts', () => {
  test('reset password and revoke sessions', () => {
    const t = setup()
    expect(t.revokeAccountSessions({ accountId: 'account-1' }).ok).toBe(true)
    expect(revokedIds(t)).toEqual(['s1'])
    expect(t.revokeAccountSessions({ accountId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'account/not_found' },
    })
  })
})
