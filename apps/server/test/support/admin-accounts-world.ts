import { createAccountFactory } from '../../src/application/account/create-account.ts'
import { deleteAccountFactory } from '../../src/application/account/delete-account.ts'
import { listAccountsFactory } from '../../src/application/account/list-accounts.ts'
import { resetAccountPasswordFactory } from '../../src/application/account/reset-account-password.ts'
import { revokeAccountSessionsFactory } from '../../src/application/account/revoke-account-sessions.ts'
import { updateAccountFactory } from '../../src/application/account/update-account.ts'
import type { Account } from '../../src/core/auth/account.ts'
import type { Session } from '../../src/core/auth/session.ts'
import type { PlaybackScope } from '../../src/core/playback/session.ts'
import {
  createFakePasswordHasher,
  createInMemoryAccounts,
  createInMemoryProfiles,
  createInMemorySessions,
  sampleAccount,
  sampleProfile,
} from './auth.ts'
import { createManualClock } from './clock.ts'
import { createSequentialIds } from './fakes.ts'
import { silentLogger } from './logger.ts'

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

export const leo = sampleAccount()
export const zoe = sampleAccount({ id: 'account-2', username: 'zoe', role: 'user' })

/** The admin account use cases on in-memory repositories: leo (admin) and zoe (user). */
export const createAdminAccountsWorld = (accounts: Account[] = [leo, zoe]) => {
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
  const deps = {
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
    playbackSessions: { endWithin: (scope: PlaybackScope) => void endedPlayback.push(scope) },
    clock,
    ids: createSequentialIds('new-'),
    logger: silentLogger,
  }
  return {
    endedPlayback,
    accountStore,
    profileStore,
    sessions,
    accounts: {
      list: listAccountsFactory(deps),
      create: createAccountFactory(deps),
      update: updateAccountFactory(deps),
      delete: deleteAccountFactory(deps),
      resetPassword: resetAccountPasswordFactory(deps),
      revokeSessions: revokeAccountSessionsFactory(deps),
    },
  }
}

export type AdminAccountsWorld = ReturnType<typeof createAdminAccountsWorld>

export const revokedIds = (t: AdminAccountsWorld) =>
  [...t.sessions.sessions.values()].filter((s) => s.revokedAt !== undefined).map((s) => s.id)
