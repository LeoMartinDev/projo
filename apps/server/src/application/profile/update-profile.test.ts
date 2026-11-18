import { describe, expect, test } from 'bun:test'

import { sampleProfile } from '../../../test/support/auth.ts'
import {
  admin,
  createProfilesWorld as setup,
  kid,
  locked,
  user,
} from '../../../test/support/profiles-world.ts'

describe('update', () => {
  test('settings, PIN set and removed, change notified', async () => {
    const t = setup()
    const set = await t.updateProfile({
      actor: user,
      profileId: 'profile-1',
      input: { name: 'Léo B', autoSkipIntro: true, subtitleMode: 'always', pin: '1111' },
    })
    expect(set).toMatchObject({
      ok: true,
      value: { name: 'Léo B', autoSkipIntro: true, subtitleMode: 'always', pinHash: 'hashed:1111' },
    })
    const removed = await t.updateProfile({
      actor: user,
      profileId: 'profile-1',
      input: { pin: '' },
    })
    expect(removed.ok && removed.value.pinHash).toBeUndefined()
    expect(t.changed).toEqual(['profile-1', 'profile-1'])
  })

  test('a user may narrow but not widen access or lift the limit', async () => {
    const t = setup([sampleProfile(), kid])
    expect(
      await t.updateProfile({ actor: user, profileId: 'kid', input: { maxContentRating: '' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
    expect(
      await t.updateProfile({ actor: user, profileId: 'kid', input: { libraryAccess: 'all' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
    expect(
      await t.updateProfile({
        actor: user,
        profileId: 'kid',
        input: { libraryIds: ['anime', 'films'] },
      }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
    expect(
      await t.updateProfile({ actor: user, profileId: 'kid', input: { maxContentRating: '0' } }),
    ).toMatchObject({ ok: true, value: { maxContentRating: '0' } })
    expect(
      await t.updateProfile({
        actor: user,
        profileId: 'profile-1',
        input: { libraryAccess: 'selected', libraryIds: ['films'] },
      }),
    ).toMatchObject({ ok: true, value: { libraryAccess: 'selected', libraryIds: ['films'] } })
  })

  test('an admin widens any profile, even of another account, but not from a restricted one', async () => {
    const other = sampleProfile({
      id: 'other',
      accountId: 'account-2',
      maxContentRating: '12',
      pinHash: 'hashed:9999',
    })
    const t = setup([sampleProfile(), kid, other])
    expect(
      await t.updateProfile({ actor: admin, profileId: 'kid', input: { maxContentRating: '' } }),
    ).toMatchObject({ ok: true })
    expect(
      await t.updateProfile({
        actor: admin,
        profileId: 'other',
        input: { maxContentRating: '16', libraryAccess: 'all' },
      }),
    ).toMatchObject({ ok: true, value: { maxContentRating: '16' } })

    const t2 = setup([sampleProfile(), kid])
    expect(
      await t2.updateProfile({
        actor: { ...admin, activeProfileId: 'kid' },
        profileId: 'kid',
        input: { maxContentRating: '18' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
  })

  test("a user cannot reach another account's profile", async () => {
    const t = setup([sampleProfile(), sampleProfile({ id: 'other', accountId: 'account-2' })])
    expect(
      await t.updateProfile({ actor: user, profileId: 'other', input: { name: 'x' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/not_found' } })
  })

  test('a PIN-locked profile that is not active needs its PIN', async () => {
    const t = setup([sampleProfile(), locked])
    expect(
      await t.updateProfile({ actor: admin, profileId: 'parent', input: { pin: '' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/pin_required' } })
    expect(
      await t.updateProfile({
        actor: admin,
        profileId: 'parent',
        input: { pin: '', currentPin: '0000' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'profile/invalid_pin' } })
    expect(
      await t.updateProfile({
        actor: admin,
        profileId: 'parent',
        input: { name: 'P', currentPin: '1234' },
      }),
    ).toMatchObject({ ok: true })
    expect(
      await t.updateProfile({
        actor: { ...admin, activeProfileId: 'parent' },
        profileId: 'parent',
        input: { name: 'P2' },
      }),
    ).toMatchObject({ ok: true })
  })
})

describe('last unrestricted profile of an admin (§14)', () => {
  test('neither narrowed nor deleted; another one may be', async () => {
    const t = setup([sampleProfile(), kid], { 'account-1': 'admin' })
    for (const input of [
      { maxContentRating: '16' as const },
      { libraryAccess: 'selected' as const },
    ]) {
      expect(await t.updateProfile({ actor: admin, profileId: 'profile-1', input })).toMatchObject({
        ok: false,
        error: { code: 'profile/last_unrestricted' },
      })
    }
    expect(t.store.profiles[0]?.libraryAccess).toBe('all')
    expect(
      (
        await t.updateProfile({
          actor: admin,
          profileId: 'kid',
          input: { maxContentRating: '0' },
        })
      ).ok,
    ).toBe(true)
  })
})

describe('Live TV access (§29.6)', () => {
  test('set by an admin on an unrestricted profile only, either way', async () => {
    const t = setup([sampleProfile(), kid])
    // Neither the profile itself (restricted or not) nor a user turns it off or on.
    for (const actor of [{ ...user, activeProfileId: 'kid' }, user]) {
      expect(
        await t.updateProfile({ actor, profileId: 'kid', input: { liveTv: false } }),
      ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
    }
    // Sending the value it already has is no change.
    expect(
      await t.updateProfile({ actor: user, profileId: 'profile-1', input: { liveTv: true } }),
    ).toMatchObject({ ok: true, value: { liveTv: true } })
    // An admin on a restricted profile does not either.
    expect(
      await t.updateProfile({
        actor: { ...admin, activeProfileId: 'kid' },
        profileId: 'kid',
        input: { liveTv: false },
      }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
    expect(t.liveTvRevoked).toEqual([])
    expect(
      await t.updateProfile({ actor: admin, profileId: 'kid', input: { liveTv: false } }),
    ).toMatchObject({ ok: true, value: { liveTv: false } })
    expect(t.liveTvRevoked).toEqual(['kid'])
    expect(
      await t.updateProfile({ actor: user, profileId: 'kid', input: { liveTv: true } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
    expect(
      await t.updateProfile({ actor: admin, profileId: 'kid', input: { liveTv: true } }),
    ).toMatchObject({ ok: true, value: { liveTv: true } })
    expect(t.liveTvRevoked).toEqual(['kid'])
  })

  test("off is not a restriction: an admin's own profile keeps its account actions", async () => {
    const t = setup([sampleProfile({ liveTv: false }), sampleProfile({ id: 'p2', name: 'Bis' })])
    expect(
      await t.updateProfile({ actor: admin, profileId: 'p2', input: { liveTv: false } }),
    ).toMatchObject({ ok: true, value: { liveTv: false } })
    expect(
      await t.updateProfile({ actor: admin, profileId: 'p2', input: { liveTv: true } }),
    ).toMatchObject({ ok: true, value: { liveTv: true } })
    // Unchanged or already off: nothing to end.
    expect(t.liveTvRevoked).toEqual(['p2'])
  })
})
