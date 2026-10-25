import { describe, expect, test } from 'bun:test'

import {
  createFakePasswordHasher,
  createInMemoryAccounts,
  createInMemoryProfiles,
  createInMemorySessions,
  sampleAccount,
  sampleProfile,
} from '../../../test/support/auth.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { Account } from '../../core/auth/account.ts'
import type { Session } from '../../core/auth/session.ts'
import type { PlaybackScope } from '../../core/playback/session.ts'
import { adminAccountsFactory } from './admin-accounts.ts'

const session = (id: string, accountId: string): Session => ({
  id,
  accountId,
  kind: 'cookie',
  tokenHash: `h-${id}`,
  deviceName: 'd',
  userAgent: '',
  createdAt: new Date(0),
  lastSeenAt: new Date(0),
  expiresAt: new Date('2099-01-01T00:00:00Z'),
})

const leo = sampleAccount()
const zoe = sampleAccount({ id: 'account-2', username: 'zoe', role: 'user' })

const setup = (accounts: Account[] = [leo, zoe]) => {
  const clock = createManualClock()
  const profileStore = createInMemoryProfiles([
    sampleProfile(),
    sampleProfile({ id: 'profile-2', accountId: 'account-2' }),
  ])
  const accountStore = createInMemoryAccounts(accounts, profileStore.profiles)
  const sessions = createInMemorySessions([
    session('s1', 'account-1'),
    session('s2', 'account-2'),
    session('s3', 'account-2'),
  ])
  const { hasher } = createFakePasswordHasher()
  const endedPlayback: PlaybackScope[] = []
  return {
    endedPlayback,
    accountStore,
    profileStore,
    sessions,
    accounts: adminAccountsFactory({
      accountRepository: accountStore.repository,
      profileRepository: profileStore.repository,
      sessionRepository: sessions.repository,
      accountActivity: () =>
        new Map([
          [
            'account-2',
            {
              accountId: 'account-2',
              lastSeenAt: new Date(0),
              lastDeviceName: 'iPhone',
              activeSessions: 2,
              playingProfileIds: ['profile-2'],
            },
          ],
        ]),
      passwordHasher: hasher,
      playbackSessions: { endWithin: (scope) => void endedPlayback.push(scope) },
      clock,
      ids: createSequentialIds('new-'),
      logger: silentLogger,
    }),
  }
}

const revokedIds = (t: ReturnType<typeof setup>) =>
  [...t.sessions.sessions.values()].filter((s) => s.revokedAt !== undefined).map((s) => s.id)

describe('admin accounts', () => {
  test('lists accounts with their profiles and activity', () => {
    const t = setup()
    expect(t.accounts.list()).toMatchObject([
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

  test('creates an account with its first profile, refuses a taken username', async () => {
    const t = setup()
    const created = await t.accounts.create({
      username: 'Sam',
      password: 'a long enough password',
      role: 'user',
      uiLocale: 'en',
    })
    expect(created).toMatchObject({
      ok: true,
      value: {
        account: {
          id: 'new-1',
          username: 'Sam',
          role: 'user',
          passwordHash: 'hashed:a long enough password',
        },
        profiles: [{ id: 'new-2', name: 'Sam', uiLocale: 'en' }],
      },
    })
    expect(
      await t.accounts.create({
        username: 'ZOE',
        password: 'x'.repeat(12),
        role: 'user',
        uiLocale: 'fr',
      }),
    ).toMatchObject({ ok: false, error: { code: 'auth/username_taken' } })
  })

  test('the last enabled admin cannot demote, disable or delete itself', () => {
    const t = setup()
    for (const change of [{ role: 'user' as const }, { disabled: true }]) {
      expect(t.accounts.update({ accountId: 'account-1', ...change })).toMatchObject({
        ok: false,
        error: { code: 'account/last_admin' },
      })
    }
    expect(t.accounts.delete({ accountId: 'account-1', confirmUsername: 'leo' })).toMatchObject({
      ok: false,
      error: { code: 'account/last_admin' },
    })
    // With a second admin, it can.
    expect(t.accounts.update({ accountId: 'account-2', role: 'admin' }).ok).toBe(true)
    expect(t.accounts.update({ accountId: 'account-1', role: 'user' }).ok).toBe(true)
    // A disabled admin does not count.
    const u = setup([
      leo,
      sampleAccount({ id: 'account-3', username: 'old', disabledAt: new Date(0) }),
    ])
    expect(u.accounts.update({ accountId: 'account-1', disabled: true })).toMatchObject({
      ok: false,
      error: { code: 'account/last_admin' },
    })
  })

  test('disabling revokes every session; enabling keeps them revoked', () => {
    const t = setup()
    expect(t.accounts.update({ accountId: 'account-2', disabled: true })).toMatchObject({
      ok: true,
      value: { account: { disabledAt: expect.any(Date) } },
    })
    expect(revokedIds(t)).toEqual(['s2', 's3'])
    // Its playback stops too (§10.6): ffmpeg, players told.
    expect(t.endedPlayback).toEqual([{ accountId: 'account-2' }])
    const enabled = t.accounts.update({ accountId: 'account-2', disabled: false })
    expect(enabled.ok && enabled.value.account.disabledAt).toBeUndefined()
    expect(revokedIds(t)).toEqual(['s2', 's3'])
  })

  test('deletion is confirmed by the username', () => {
    const t = setup()
    expect(t.accounts.delete({ accountId: 'account-2', confirmUsername: 'zo' })).toMatchObject({
      ok: false,
      error: { code: 'account/confirmation_mismatch' },
    })
    expect(t.endedPlayback).toEqual([])
    expect(t.accounts.delete({ accountId: 'account-2', confirmUsername: ' ZOE ' }).ok).toBe(true)
    expect(t.endedPlayback).toEqual([{ accountId: 'account-2' }])
    expect(t.accountStore.accounts.map((a) => a.id)).toEqual(['account-1'])
    expect(t.profileStore.profiles.map((p) => p.id)).toEqual(['profile-1'])
    expect(t.accounts.delete({ accountId: 'account-2', confirmUsername: 'zoe' })).toMatchObject({
      ok: false,
      error: { code: 'account/not_found' },
    })
  })

  test('reset password and revoke sessions', async () => {
    const t = setup()
    expect(
      (await t.accounts.resetPassword({ accountId: 'account-2', password: 'new long password' }))
        .ok,
    ).toBe(true)
    expect(t.accountStore.accounts[1]?.passwordHash).toBe('hashed:new long password')
    expect(revokedIds(t)).toEqual(['s2', 's3'])
    expect(t.accounts.revokeSessions({ accountId: 'account-1' }).ok).toBe(true)
    expect(revokedIds(t)).toEqual(['s1', 's2', 's3'])
    expect(t.accounts.revokeSessions({ accountId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'account/not_found' },
    })
  })
})
