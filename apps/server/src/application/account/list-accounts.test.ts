import { describe, expect, test } from 'bun:test'

import { createAdminAccountsWorld as setup } from '../../../test/support/admin-accounts-world.ts'

describe('admin accounts', () => {
  test('lists accounts with their profiles and activity', () => {
    const t = setup()
    expect(t.listAccounts()).toMatchObject([
      {
        account: { id: 'account-1' },
        profiles: [{ id: 'profile-1' }],
        activity: { activeSessions: 0 },
      },
      {
        account: { id: 'account-2' },
        profiles: [{ id: 'profile-2' }],
        activity: { lastDeviceName: 'iPhone', playingProfileIds: ['profile-2'] },
      },
    ])
  })
})
