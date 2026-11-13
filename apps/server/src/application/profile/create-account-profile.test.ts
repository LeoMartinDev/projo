import { describe, expect, test } from 'bun:test'

import { sampleProfile } from '../../../test/support/auth.ts'
import { createProfilesWorld as setup } from '../../../test/support/profiles-world.ts'

describe('create', () => {
  test('an admin adds a profile to another account, up to 5; unknown account refused', async () => {
    const t = setup([sampleProfile(), sampleProfile({ id: 'zoe-1', accountId: 'account-2' })])
    const created = await t.createAccountProfile({
      accountId: 'account-2',
      input: { name: 'Petit', libraryAccess: 'selected', libraryIds: ['anime'] },
    })
    expect(created).toMatchObject({
      ok: true,
      value: { accountId: 'account-2', name: 'Petit', libraryAccess: 'selected' },
    })
    for (const name of ['B', 'C', 'D']) {
      await t.createAccountProfile({ accountId: 'account-2', input: { name } })
    }
    expect(
      await t.createAccountProfile({ accountId: 'account-2', input: { name: 'F' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/limit_reached' } })
    expect(await t.createAccountProfile({ accountId: 'nope', input: { name: 'X' } })).toMatchObject(
      { ok: false, error: { code: 'account/not_found' } },
    )
  })
})
