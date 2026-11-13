import { describe, expect, test } from 'bun:test'

import {
  createAdminAccountsWorld as setup,
  revokedIds,
} from '../../../test/support/admin-accounts-world.ts'

describe('admin accounts', () => {
  test('reset password and revoke sessions', async () => {
    const t = setup()
    expect(
      (await t.resetAccountPassword({ accountId: 'account-2', password: 'new long password' })).ok,
    ).toBe(true)
    expect(t.accountStore.accounts[1]?.passwordHash).toBe('hashed:new long password')
    expect(revokedIds(t)).toEqual(['s2', 's3'])
  })
})
