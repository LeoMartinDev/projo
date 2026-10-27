import { describe, expect, test } from 'bun:test'

import type { AccountRole } from '@projo/shared/api/auth'

import {
  createCountingRateLimiter,
  createFakePasswordHasher,
  createInMemoryProfiles,
  createInMemorySessions,
  sampleProfile,
} from '../../../test/support/auth.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { PlaybackScope } from '../../core/playback/session.ts'
import type { Profile } from '../../core/profile/profile.ts'
import { checkPinFactory } from './pin.ts'
import { type ProfileActor, profilesFactory } from './profiles.ts'
import { visibilityScopeFactory } from './visibility-scope.ts'

const setup = (
  profiles: Profile[] = [sampleProfile()],
  roles: Record<string, AccountRole> = { 'account-1': 'user', 'account-2': 'user' },
) => {
  const clock = createManualClock()
  const store = createInMemoryProfiles(profiles, { libraryIds: ['films', 'series', 'anime'] })
  const sessions = createInMemorySessions()
  const { hasher } = createFakePasswordHasher()
  const rate = createCountingRateLimiter(5)
  const changed: string[] = []
  const endedPlayback: PlaybackScope[] = []
  const scopes = visibilityScopeFactory({ profileRepository: store.repository, clock })
  return {
    clock,
    store,
    sessions,
    rate,
    changed,
    endedPlayback,
    scopes,
    profiles: profilesFactory({
      profileRepository: store.repository,
      sessionRepository: sessions.repository,
      passwordHasher: hasher,
      checkPin: checkPinFactory({
        passwordHasher: hasher,
        rateLimiter: rate.limiter,
        logger: silentLogger,
      }),
      playbackSessions: { endWithin: (scope) => void endedPlayback.push(scope) },
      accountRole: (accountId) => roles[accountId],
      profileChanged: (id) => {
        changed.push(id)
        scopes.invalidate(id)
      },
      clock,
      ids: createSequentialIds('new-profile-'),
      logger: silentLogger,
    }),
  }
}

const admin: ProfileActor = {
  accountId: 'account-1',
  role: 'admin',
  sessionId: 's1',
  activeProfileId: 'profile-1',
}
const user: ProfileActor = { ...admin, role: 'user' }

const kid = sampleProfile({
  id: 'kid',
  name: 'Enfants',
  libraryAccess: 'selected',
  libraryIds: ['anime'],
  maxContentRating: '10',
  avatarColor: 'violet',
})
const locked = sampleProfile({ id: 'parent', name: 'Parent', pinHash: 'hashed:1234' })

describe('create', () => {
  test('defaults: next colour, languages from the interface, unrestricted for an admin', async () => {
    const t = setup()
    const result = await t.profiles.create({ actor: admin, input: { name: 'Zoé', uiLocale: 'en' } })
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
    const first = await t.profiles.create({ actor: admin, input: { name: 'A', pin: '4321' } })
    expect(first.ok && first.value.pinHash).toBe('hashed:4321')
    for (const name of ['B', 'C', 'D']) await t.profiles.create({ actor: admin, input: { name } })
    expect(await t.profiles.create({ actor: admin, input: { name: 'F' } })).toMatchObject({
      ok: false,
      error: { code: 'profile/limit_reached' },
    })
  })

  test('an admin adds a profile to another account, up to 5; unknown account refused', async () => {
    const t = setup([sampleProfile(), sampleProfile({ id: 'zoe-1', accountId: 'account-2' })])
    const created = await t.profiles.createForAccount({
      accountId: 'account-2',
      input: { name: 'Petit', libraryAccess: 'selected', libraryIds: ['anime'] },
    })
    expect(created).toMatchObject({
      ok: true,
      value: { accountId: 'account-2', name: 'Petit', libraryAccess: 'selected' },
    })
    for (const name of ['B', 'C', 'D']) {
      await t.profiles.createForAccount({ accountId: 'account-2', input: { name } })
    }
    expect(
      await t.profiles.createForAccount({ accountId: 'account-2', input: { name: 'F' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/limit_reached' } })
    expect(
      await t.profiles.createForAccount({ accountId: 'nope', input: { name: 'X' } }),
    ).toMatchObject({ ok: false, error: { code: 'account/not_found' } })
  })

  test('a restricted profile creates no profile (§14)', async () => {
    const t = setup([sampleProfile(), kid])
    const actor = { ...admin, activeProfileId: 'kid' }
    for (const input of [{ name: 'Bis' }, { name: 'Ter', maxContentRating: '0' as const }]) {
      expect(await t.profiles.create({ actor, input })).toMatchObject({
        ok: false,
        error: { code: 'profile/restricted' },
      })
    }
    expect(t.store.profiles).toHaveLength(2)
  })

  test('without a resolved profile, the actor is the most restricted profile of the account', async () => {
    const restricted = setup([sampleProfile(), kid])
    const { activeProfileId: _active, ...none } = admin
    expect(await restricted.profiles.create({ actor: none, input: { name: 'X' } })).toMatchObject({
      ok: false,
      error: { code: 'profile/restricted' },
    })
    // A foreign profile id is not resolved either.
    const foreign = setup([
      sampleProfile(),
      kid,
      sampleProfile({ id: 'z', accountId: 'account-2' }),
    ])
    expect(
      await foreign.profiles.create({
        actor: { ...admin, activeProfileId: 'z' },
        input: { name: 'X' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'profile/restricted' } })
    // An account without restricted profiles keeps managing them before "Who's watching?".
    const open = setup([sampleProfile(), sampleProfile({ id: 'p2' })])
    expect(
      await open.profiles.create({ actor: { ...none, role: 'user' }, input: { name: 'X' } }),
    ).toMatchObject({ ok: true, value: { libraryAccess: 'all' } })
  })

  test('parallel creations stop at 5 profiles', async () => {
    const t = setup()
    const results = await Promise.all(
      ['B', 'C', 'D', 'E', 'F', 'G'].map((name) =>
        t.profiles.create({ actor: admin, input: { name, pin: '1234' } }),
      ),
    )
    expect(results.filter((result) => result.ok)).toHaveLength(4)
    expect(t.store.profiles).toHaveLength(5)
  })

  test('unknown libraries are refused', async () => {
    const t = setup()
    expect(
      await t.profiles.create({
        actor: admin,
        input: { name: 'X', libraryAccess: 'selected', libraryIds: ['films', 'ghost'] },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'profile/unknown_library', context: { libraryIds: ['ghost'] } },
    })
  })
})

describe('update', () => {
  test('settings, PIN set and removed, change notified', async () => {
    const t = setup()
    const set = await t.profiles.update({
      actor: user,
      profileId: 'profile-1',
      input: { name: 'Léo B', autoSkipIntro: true, subtitleMode: 'always', pin: '1111' },
    })
    expect(set).toMatchObject({
      ok: true,
      value: { name: 'Léo B', autoSkipIntro: true, subtitleMode: 'always', pinHash: 'hashed:1111' },
    })
    const removed = await t.profiles.update({
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
      await t.profiles.update({ actor: user, profileId: 'kid', input: { maxContentRating: '' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
    expect(
      await t.profiles.update({ actor: user, profileId: 'kid', input: { libraryAccess: 'all' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
    expect(
      await t.profiles.update({
        actor: user,
        profileId: 'kid',
        input: { libraryIds: ['anime', 'films'] },
      }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
    expect(
      await t.profiles.update({ actor: user, profileId: 'kid', input: { maxContentRating: '0' } }),
    ).toMatchObject({ ok: true, value: { maxContentRating: '0' } })
    expect(
      await t.profiles.update({
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
      await t.profiles.update({ actor: admin, profileId: 'kid', input: { maxContentRating: '' } }),
    ).toMatchObject({ ok: true })
    expect(
      await t.profiles.update({
        actor: admin,
        profileId: 'other',
        input: { maxContentRating: '16', libraryAccess: 'all' },
      }),
    ).toMatchObject({ ok: true, value: { maxContentRating: '16' } })

    const t2 = setup([sampleProfile(), kid])
    expect(
      await t2.profiles.update({
        actor: { ...admin, activeProfileId: 'kid' },
        profileId: 'kid',
        input: { maxContentRating: '18' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'profile/admin_only' } })
  })

  test("a user cannot reach another account's profile", async () => {
    const t = setup([sampleProfile(), sampleProfile({ id: 'other', accountId: 'account-2' })])
    expect(
      await t.profiles.update({ actor: user, profileId: 'other', input: { name: 'x' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/not_found' } })
  })

  test('a PIN-locked profile that is not active needs its PIN', async () => {
    const t = setup([sampleProfile(), locked])
    expect(
      await t.profiles.update({ actor: admin, profileId: 'parent', input: { pin: '' } }),
    ).toMatchObject({ ok: false, error: { code: 'profile/pin_required' } })
    expect(
      await t.profiles.update({
        actor: admin,
        profileId: 'parent',
        input: { pin: '', currentPin: '0000' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'profile/invalid_pin' } })
    expect(
      await t.profiles.update({
        actor: admin,
        profileId: 'parent',
        input: { name: 'P', currentPin: '1234' },
      }),
    ).toMatchObject({ ok: true })
    expect(
      await t.profiles.update({
        actor: { ...admin, activeProfileId: 'parent' },
        profileId: 'parent',
        input: { name: 'P2' },
      }),
    ).toMatchObject({ ok: true })
  })
})

describe('delete', () => {
  test('keeps at least one profile', async () => {
    const t = setup()
    expect(await t.profiles.delete({ actor: user, profileId: 'profile-1' })).toMatchObject({
      ok: false,
      error: { code: 'profile/last_profile' },
    })
  })

  test('deletes another profile; a locked one needs its PIN', async () => {
    const t = setup([sampleProfile(), kid, locked])
    expect((await t.profiles.delete({ actor: user, profileId: 'kid' })).ok).toBe(true)
    // Its playback stops before the cascade drops the rows (§10.6).
    expect(t.endedPlayback).toEqual([{ profileIds: ['kid'] }])
    expect(await t.profiles.delete({ actor: user, profileId: 'parent' })).toMatchObject({
      ok: false,
      error: { code: 'profile/pin_required' },
    })
    expect(
      (await t.profiles.delete({ actor: user, profileId: 'parent', currentPin: '1234' })).ok,
    ).toBe(true)
    expect(t.store.profiles.map((profile) => profile.id)).toEqual(['profile-1'])
  })
})

describe('last unrestricted profile of an admin (§14)', () => {
  test('neither narrowed nor deleted; another one may be', async () => {
    const t = setup([sampleProfile(), kid], { 'account-1': 'admin' })
    for (const input of [
      { maxContentRating: '16' as const },
      { libraryAccess: 'selected' as const },
    ]) {
      expect(
        await t.profiles.update({ actor: admin, profileId: 'profile-1', input }),
      ).toMatchObject({ ok: false, error: { code: 'profile/last_unrestricted' } })
    }
    expect(await t.profiles.delete({ actor: admin, profileId: 'profile-1' })).toMatchObject({
      ok: false,
      error: { code: 'profile/last_unrestricted' },
    })
    expect(t.store.profiles[0]?.libraryAccess).toBe('all')
    expect(
      (
        await t.profiles.update({
          actor: admin,
          profileId: 'kid',
          input: { maxContentRating: '0' },
        })
      ).ok,
    ).toBe(true)
  })
})

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
    expect((await t.profiles.select({ actor: user, profileId: 'profile-1' })).ok).toBe(true)
    expect(t.sessions.sessions.get(session.id)?.lastProfileId).toBe('profile-1')
    expect(await t.profiles.select({ actor: user, profileId: 'parent' })).toMatchObject({
      ok: false,
      error: { code: 'profile/pin_required' },
    })
    expect(
      await t.profiles.select({ actor: user, profileId: 'parent', pin: '9999' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'profile/invalid_pin' },
    })
    expect((await t.profiles.select({ actor: user, profileId: 'parent', pin: '1234' })).ok).toBe(
      true,
    )
    expect(t.sessions.sessions.get(session.id)?.lastProfileId).toBe('parent')
  })

  test('5 checks per profile, then rate limited even with the right PIN', async () => {
    const t = setup([sampleProfile(), locked])
    for (let i = 0; i < 5; i += 1) {
      expect(
        await t.profiles.verifyPin({ actor: user, profileId: 'parent', pin: '0000' }),
      ).toMatchObject({ ok: false, error: { code: 'profile/invalid_pin' } })
    }
    expect(
      await t.profiles.verifyPin({ actor: user, profileId: 'parent', pin: '1234' }),
    ).toMatchObject({ ok: false, error: { code: 'profile/rate_limited' } })
  })

  test('a success clears the counter; foreign profiles are not found', async () => {
    const t = setup([sampleProfile(), locked, sampleProfile({ id: 'x', accountId: 'account-2' })])
    await t.profiles.verifyPin({ actor: user, profileId: 'parent', pin: '0000' })
    expect((await t.profiles.verifyPin({ actor: user, profileId: 'parent', pin: '1234' })).ok).toBe(
      true,
    )
    expect(t.rate.hits.size).toBe(0)
    expect(await t.profiles.select({ actor: admin, profileId: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'profile/not_found' },
    })
  })
})

describe('visibility scope resolver', () => {
  test('cached, invalidated by a change, nothing for an unknown profile', async () => {
    const t = setup([sampleProfile(), kid, sampleProfile({ id: 'boss' })])
    expect(t.scopes.resolve('profile-1')).toEqual({})
    expect(t.scopes.resolve('kid')).toMatchObject({
      libraryIds: ['anime'],
      allowedRatings: { FR: ['U', 'TP', '10'] },
    })
    expect(t.scopes.resolve('ghost')).toEqual({ libraryIds: [] })

    // A direct write is not seen while cached…
    t.store.profiles[0] = { ...sampleProfile(), maxContentRating: '0' }
    expect(t.scopes.resolve('profile-1')).toEqual({})
    // …until the TTL expires, or at once through the use case.
    t.clock.advance(10_000)
    expect(t.scopes.resolve('profile-1').allowedRatings?.['FR']).toEqual(['U', 'TP'])
    const adminElsewhere = { ...admin, activeProfileId: 'boss' }
    expect(
      (
        await t.profiles.update({
          actor: adminElsewhere,
          profileId: 'profile-1',
          input: { maxContentRating: '' },
        })
      ).ok,
    ).toBe(true)
    expect(t.scopes.resolve('profile-1')).toEqual({})
  })
})
