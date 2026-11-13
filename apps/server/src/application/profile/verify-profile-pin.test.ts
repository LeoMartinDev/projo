import { describe, expect, test } from 'bun:test'

import { sampleProfile } from '../../../test/support/auth.ts'
import {
  admin,
  createProfilesWorld as setup,
  locked,
  user,
} from '../../../test/support/profiles-world.ts'

describe('PIN and selection (§13.6, §20)', () => {
  test('5 checks per profile, then rate limited even with the right PIN', async () => {
    const t = setup([sampleProfile(), locked])
    for (let i = 0; i < 5; i += 1) {
      expect(
        await t.verifyProfilePin({ actor: user, profileId: 'parent', pin: '0000' }),
      ).toMatchObject({ ok: false, error: { code: 'profile/invalid_pin' } })
    }
    expect(
      await t.verifyProfilePin({ actor: user, profileId: 'parent', pin: '1234' }),
    ).toMatchObject({ ok: false, error: { code: 'profile/rate_limited' } })
  })

  test('a success clears the counter; foreign profiles are not found', async () => {
    const t = setup([sampleProfile(), locked, sampleProfile({ id: 'x', accountId: 'account-2' })])
    await t.verifyProfilePin({ actor: user, profileId: 'parent', pin: '0000' })
    expect((await t.verifyProfilePin({ actor: user, profileId: 'parent', pin: '1234' })).ok).toBe(
      true,
    )
    expect(t.rate.hits.size).toBe(0)
    expect(await t.selectProfile({ actor: admin, profileId: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'profile/not_found' },
    })
  })
})
