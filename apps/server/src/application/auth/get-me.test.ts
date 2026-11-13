import { describe, expect, test } from 'bun:test'

import { sampleProfile } from '../../../test/support/auth.ts'
import { createAuthWorld as setup } from '../../../test/support/auth-world.ts'

describe('getMe', () => {
  test('account and its profiles', () => {
    const t = setup()
    expect(t.getMe({ accountId: 'account-1', activeProfileId: 'profile-1' })).toMatchObject({
      ok: true,
      value: {
        account: { id: 'account-1', username: 'Leo', role: 'admin' },
        profiles: [{ id: 'profile-1' }],
        activeProfileId: 'profile-1',
        needsProfileSelection: false,
      },
    })
  })

  test('"Qui regarde ?" when no profile of the account is active', () => {
    const t = setup({ profiles: [sampleProfile(), sampleProfile({ id: 'profile-2' })] })
    const me = t.getMe({ accountId: 'account-1', activeProfileId: undefined })
    expect(me).toMatchObject({ ok: true, value: { needsProfileSelection: true } })
    expect(me.ok && me.value.activeProfileId).toBeUndefined()
  })
})
