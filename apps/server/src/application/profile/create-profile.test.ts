import { describe, expect, test } from 'bun:test'

import { sampleProfile } from '../../../test/support/auth.ts'
import { admin, createProfilesWorld as setup, kid } from '../../../test/support/profiles-world.ts'

describe('create', () => {
  test('defaults: next colour, languages from the interface, unrestricted for an admin', async () => {
    const t = setup()
    const result = await t.createProfile({ actor: admin, input: { name: 'Zoé', uiLocale: 'en' } })
    expect(result).toMatchObject({
      ok: true,
      value: {
        id: 'new-profile-1',
        accountId: 'account-1',
        avatarColor: 'terracotta',
        audioLanguage: 'en',
        subtitleLanguage: 'en',
        libraryAccess: 'all',
        libraryIds: [],
      },
    })
    expect(result.ok && result.value.maxContentRating).toBeUndefined()
  })

  test('PIN is hashed, at most 5 profiles', async () => {
    const t = setup()
    const first = await t.createProfile({ actor: admin, input: { name: 'A', pin: '4321' } })
    expect(first.ok && first.value.pinHash).toBe('hashed:4321')
    for (const name of ['B', 'C', 'D']) await t.createProfile({ actor: admin, input: { name } })
    expect(await t.createProfile({ actor: admin, input: { name: 'F' } })).toMatchObject({
      ok: false,
      error: { code: 'profile/limit_reached' },
    })
  })

  test('a restricted profile creates no profile (§14)', async () => {
    const t = setup([sampleProfile(), kid])
    const actor = { ...admin, activeProfileId: 'kid' }
    for (const input of [{ name: 'Bis' }, { name: 'Ter', maxContentRating: '0' as const }]) {
      expect(await t.createProfile({ actor, input })).toMatchObject({
        ok: false,
        error: { code: 'profile/restricted' },
      })
    }
    expect(t.store.profiles).toHaveLength(2)
  })

  test('without a resolved profile, the actor is the most restricted profile of the account', async () => {
    const restricted = setup([sampleProfile(), kid])
    const { activeProfileId: _active, ...none } = admin
    expect(await restricted.createProfile({ actor: none, input: { name: 'X' } })).toMatchObject({
      ok: false,
      error: { code: 'profile/restricted' },
    })
    const foreign = setup([
      sampleProfile(),
      kid,
      sampleProfile({ id: 'z', accountId: 'account-2' }),
    ])
    expect(
      await foreign.createProfile({
        actor: { ...admin, activeProfileId: 'z' },
        input: { name: 'X' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'profile/restricted' } })
    const open = setup([sampleProfile(), sampleProfile({ id: 'p2' })])
    expect(
      await open.createProfile({ actor: { ...none, role: 'user' }, input: { name: 'X' } }),
    ).toMatchObject({ ok: true, value: { libraryAccess: 'all' } })
  })

  test('parallel creations stop at 5 profiles', async () => {
    const t = setup()
    const results = await Promise.all(
      ['B', 'C', 'D', 'E', 'F', 'G'].map((name) =>
        t.createProfile({ actor: admin, input: { name, pin: '1234' } }),
      ),
    )
    expect(results.filter((result) => result.ok)).toHaveLength(4)
    expect(t.store.profiles).toHaveLength(5)
  })

  test('unknown libraries are refused', async () => {
    const t = setup()
    expect(
      await t.createProfile({
        actor: admin,
        input: { name: 'X', libraryAccess: 'selected', libraryIds: ['films', 'ghost'] },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'profile/unknown_library', context: { libraryIds: ['ghost'] } },
    })
  })
})
