import { describe, expect, test } from 'bun:test'

import { createAdminAccountsWorld as setup } from '../../../test/support/admin-accounts-world.ts'

describe('admin accounts', () => {
  test('deletion is confirmed by the username', () => {
    const t = setup()
    expect(t.accounts.delete({ accountId: 'account-2', confirmUsername: 'zo' })).toMatchObject({
      ok: false,
      error: { code: 'account/confirmation_mismatch' },
    })
    expect(t.endedPlayback).toEqual([])
    expect(t.accounts.delete({ accountId: 'account-2', confirmUsername: ' ZOE ' }).ok).toBe(true)
    expect(t.endedPlayback).toEqual([{ accountId: 'account-2' }])
    expect(t.accountStore.accounts.map((a) => a.id)).toEqual(['account-1'])
    expect(t.profileStore.profiles.map((p) => p.id)).toEqual(['profile-1'])
    expect(t.accounts.delete({ accountId: 'account-2', confirmUsername: 'zoe' })).toMatchObject({
      ok: false,
      error: { code: 'account/not_found' },
    })
  })
})
