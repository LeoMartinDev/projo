import { describe, expect, test } from 'bun:test'

import { sampleProfile } from '../../../test/support/auth.ts'
import {
  admin,
  createProfilesWorld as setup,
  kid,
  locked,
  user,
} from '../../../test/support/profiles-world.ts'

describe('delete', () => {
  test('keeps at least one profile', async () => {
    const t = setup()
    expect(await t.deleteProfile({ actor: user, profileId: 'profile-1' })).toMatchObject({
      ok: false,
      error: { code: 'profile/last_profile' },
    })
  })

  test('deletes another profile; a locked one needs its PIN', async () => {
    const t = setup([sampleProfile(), kid, locked])
    expect((await t.deleteProfile({ actor: user, profileId: 'kid' })).ok).toBe(true)
    expect(t.endedPlayback).toEqual([{ profileIds: ['kid'] }])
    expect(await t.deleteProfile({ actor: user, profileId: 'parent' })).toMatchObject({
      ok: false,
      error: { code: 'profile/pin_required' },
    })
    expect(
      (await t.deleteProfile({ actor: user, profileId: 'parent', currentPin: '1234' })).ok,
    ).toBe(true)
    expect(t.store.profiles.map((profile) => profile.id)).toEqual(['profile-1'])
  })
})

describe('last unrestricted profile of an admin (§14)', () => {
  test('neither narrowed nor deleted; another one may be', async () => {
    const t = setup([sampleProfile(), kid], { 'account-1': 'admin' })
    expect(await t.deleteProfile({ actor: admin, profileId: 'profile-1' })).toMatchObject({
      ok: false,
      error: { code: 'profile/last_unrestricted' },
    })
    expect(t.store.profiles[0]?.libraryAccess).toBe('all')
  })
})
