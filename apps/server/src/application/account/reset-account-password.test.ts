import { describe, expect, test } from 'bun:test'

import {
  createAdminAccountsWorld as setup,
  revokedIds,
} from '../../../test/support/admin-accounts-world.ts'

describe('admin accounts', () => {
  test('reset password and revoke sessions', async () => {
    const t = setup()
    expect(
      (await t.accounts.resetPassword({ accountId: 'account-2', password: 'new long password' }))
        .ok,
    ).toBe(true)
    expect(t.accountStore.accounts[1]?.passwordHash).toBe('hashed:new long password')
    expect(revokedIds(t)).toEqual(['s2', 's3'])
    expect(t.accounts.revokeSessions({ accountId: 'account-1' }).ok).toBe(true)
    expect(revokedIds(t)).toEqual(['s1', 's2', 's3'])
    expect(t.accounts.revokeSessions({ accountId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'account/not_found' },
    })
  })
})
