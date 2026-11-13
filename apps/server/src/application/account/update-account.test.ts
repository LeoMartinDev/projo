import { describe, expect, test } from 'bun:test'

import { sampleAccount } from '../../../test/support/auth.ts'
import {
  createAdminAccountsWorld as setup,
  leo,
  revokedIds,
} from '../../../test/support/admin-accounts-world.ts'

describe('admin accounts', () => {
  test('the last enabled admin cannot demote, disable or delete itself', () => {
    const t = setup()
    for (const change of [{ role: 'user' as const }, { disabled: true }]) {
      expect(t.updateAccount({ accountId: 'account-1', ...change })).toMatchObject({
        ok: false,
        error: { code: 'account/last_admin' },
      })
    }
    expect(t.updateAccount({ accountId: 'account-2', role: 'admin' }).ok).toBe(true)
    expect(t.updateAccount({ accountId: 'account-1', role: 'user' }).ok).toBe(true)
    const u = setup([
      leo,
      sampleAccount({ id: 'account-3', username: 'old', disabledAt: new Date(0) }),
    ])
    expect(u.updateAccount({ accountId: 'account-1', disabled: true })).toMatchObject({
      ok: false,
      error: { code: 'account/last_admin' },
    })
  })

  test('disabling revokes every session; enabling keeps them revoked', () => {
    const t = setup()
    expect(t.updateAccount({ accountId: 'account-2', disabled: true })).toMatchObject({
      ok: true,
      value: { account: { disabledAt: expect.any(Date) } },
    })
    expect(revokedIds(t)).toEqual(['s2', 's3'])
    expect(t.endedPlayback).toEqual([{ accountId: 'account-2' }])
    const enabled = t.updateAccount({ accountId: 'account-2', disabled: false })
    expect(enabled.ok && enabled.value.account.disabledAt).toBeUndefined()
    expect(revokedIds(t)).toEqual(['s2', 's3'])
  })
})
