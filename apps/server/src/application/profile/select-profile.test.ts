import { describe, expect, test } from 'bun:test'

import { sampleProfile } from '../../../test/support/auth.ts'
import { createProfilesWorld as setup, locked, user } from '../../../test/support/profiles-world.ts'

describe('PIN and selection (§13.6, §20)', () => {
  test('select remembers the profile for the session, with its PIN when it has one', async () => {
    const t = setup([sampleProfile(), locked])
    const { session } = {
      session: t.sessions.repository.create({
        id: 's1',
        accountId: 'account-1',
        kind: 'cookie',
        tokenHash: 'h',
        deviceName: 'd',
        userAgent: '',
        createdAt: new Date(0),
        lastSeenAt: new Date(0),
        expiresAt: new Date(10 ** 13),
      }),
    }
    expect((await t.selectProfile({ actor: user, profileId: 'profile-1' })).ok).toBe(true)
    expect(t.sessions.sessions.get(session.id)?.lastProfileId).toBe('profile-1')
    expect(await t.selectProfile({ actor: user, profileId: 'parent' })).toMatchObject({
      ok: false,
      error: { code: 'profile/pin_required' },
    })
    expect(await t.selectProfile({ actor: user, profileId: 'parent', pin: '9999' })).toMatchObject({
      ok: false,
      error: { code: 'profile/invalid_pin' },
    })
    expect((await t.selectProfile({ actor: user, profileId: 'parent', pin: '1234' })).ok).toBe(true)
    expect(t.sessions.sessions.get(session.id)?.lastProfileId).toBe('parent')
  })
})
