import { describe, expect, test } from 'bun:test'

import { sampleProfile } from '../../../test/support/auth.ts'
import { admin, createProfilesWorld as setup, kid } from '../../../test/support/profiles-world.ts'

describe('visibility scope resolver', () => {
  test('cached, invalidated by a change, nothing for an unknown profile', async () => {
    const t = setup([sampleProfile(), kid, sampleProfile({ id: 'boss' })])
    expect(t.scopes.resolve('profile-1')).toEqual({})
    expect(t.scopes.resolve('kid')).toMatchObject({
      libraryIds: ['anime'],
      allowedRatings: { FR: ['U', 'TP', '10'] },
    })
    expect(t.scopes.resolve('ghost')).toEqual({ libraryIds: [] })

    t.store.profiles[0] = { ...sampleProfile(), maxContentRating: '0' }
    expect(t.scopes.resolve('profile-1')).toEqual({})
    t.clock.advance(10_000)
    expect(t.scopes.resolve('profile-1').allowedRatings?.['FR']).toEqual(['U', 'TP'])
    const adminElsewhere = { ...admin, activeProfileId: 'boss' }
    expect(
      (
        await t.updateProfile({
          actor: adminElsewhere,
          profileId: 'profile-1',
          input: { maxContentRating: '' },
        })
      ).ok,
    ).toBe(true)
    expect(t.scopes.resolve('profile-1')).toEqual({})
  })
})
