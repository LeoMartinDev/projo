import { describe, expect, test } from 'bun:test'

import { createAdminAccountsWorld as setup } from '../../../test/support/admin-accounts-world.ts'

describe('admin accounts', () => {
  test('creates an account with its first profile, refuses a taken username', async () => {
    const t = setup()
    const created = await t.accounts.create({
      username: 'Sam',
      password: 'a long enough password',
      role: 'user',
      uiLocale: 'en',
    })
    expect(created).toMatchObject({
      ok: true,
      value: {
        account: {
          id: 'new-1',
          username: 'Sam',
          role: 'user',
          passwordHash: 'hashed:a long enough password',
        },
        profiles: [{ id: 'new-2', name: 'Sam', uiLocale: 'en' }],
      },
    })
    expect(
      await t.accounts.create({
        username: 'ZOE',
        password: 'x'.repeat(12),
        role: 'user',
        uiLocale: 'fr',
      }),
    ).toMatchObject({ ok: false, error: { code: 'auth/username_taken' } })
  })
})
