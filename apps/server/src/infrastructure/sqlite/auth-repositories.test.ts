import { beforeEach, describe, expect, test } from 'bun:test'

import { sampleAccount, sampleProfile } from '../../../test/support/auth.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Session } from '../../core/auth/session.ts'
import { createSqliteAccountRepository } from './account-repository.ts'
import type { Db } from './database.ts'
import { createSqliteProfileRepository } from './profile-repository.ts'
import { createSqliteSessionRepository } from './session-repository.ts'
import { createSqliteSettingsRepository } from './settings-repository.ts'
import { createSqliteSetupRepository } from './setup-repository.ts'

const at = new Date('2026-02-01T10:00:00.000Z')
const later = (ms: number) => new Date(at.getTime() + ms)

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  accountId: 'account-1',
  kind: 'cookie',
  tokenHash: 'hash-1',
  deviceName: 'Firefox · macOS',
  userAgent: 'Mozilla/5.0',
  createdAt: at,
  lastSeenAt: at,
  expiresAt: later(1_000_000),
  ...overrides,
})

let db: Db
beforeEach(() => {
  db = createTestDatabase()
})

const completeSetup = () =>
  createSqliteSetupRepository({ db }).complete({
    account: sampleAccount(),
    profile: sampleProfile(),
    settings: { 'server.name': 'Maison', 'metadata.language': 'fr-FR' },
    at,
  })

describe('SQLite setup repository', () => {
  test('writes account, profile and settings once', () => {
    const setup = createSqliteSetupRepository({ db })
    expect(setup.isCompleted()).toBe(false)
    expect(completeSetup()).toBe('completed')
    expect(setup.isCompleted()).toBe(true)

    expect(
      setup.complete({
        account: sampleAccount({ id: 'account-2', username: 'other' }),
        profile: sampleProfile({ id: 'profile-2', accountId: 'account-2' }),
        settings: { 'server.name': 'Pirate' },
        at,
      }),
    ).toBe('already_completed')
    expect(createSqliteAccountRepository({ db }).list()).toHaveLength(1)

    const settings = createSqliteSettingsRepository({ db })
    expect(settings.get('server.name')).toBe('Maison')
    expect(settings.get('metadata.language')).toBe('fr-FR')
  })
})

describe('SQLite account and profile repositories', () => {
  beforeEach(() => {
    completeSetup()
  })

  test('finds accounts by id and by username, case-insensitively', () => {
    const accounts = createSqliteAccountRepository({ db })
    expect(accounts.findById('account-1')).toEqual(sampleAccount())
    expect(accounts.findByUsername('LEO')).toEqual(sampleAccount())
    expect(accounts.findByUsername('nobody')).toBeUndefined()
  })

  test('maps profiles without nulls', () => {
    const profiles = createSqliteProfileRepository({ db })
    expect(profiles.findById('profile-1')).toEqual(sampleProfile())
    expect(profiles.listByAccount('account-1')).toEqual([sampleProfile()])
    expect(profiles.listByAccount('account-2')).toEqual([])
  })
})

describe('SQLite session repository', () => {
  beforeEach(() => {
    completeSetup()
  })

  test('creates, finds by token hash, touches, remembers the profile and revokes', () => {
    const sessions = createSqliteSessionRepository({ db })
    expect(sessions.create(session())).toEqual(session())
    expect(sessions.findByTokenHash('hash-1')).toEqual(session())
    expect(sessions.findByTokenHash('other')).toBeUndefined()

    sessions.touch({ id: 'session-1', lastSeenAt: later(10), expiresAt: later(2_000_000) })
    sessions.setLastProfile({ id: 'session-1', profileId: 'profile-1' })
    expect(sessions.findById('session-1')).toEqual(
      session({ lastSeenAt: later(10), expiresAt: later(2_000_000), lastProfileId: 'profile-1' }),
    )

    sessions.revoke({ id: 'session-1', revokedAt: later(20) })
    sessions.revoke({ id: 'session-1', revokedAt: later(30) })
    expect(sessions.findById('session-1')?.revokedAt).toEqual(later(20))
  })

  test('lists active sessions, most recently seen first', () => {
    const sessions = createSqliteSessionRepository({ db })
    sessions.create(session())
    sessions.create(
      session({ id: 'session-2', tokenHash: 'hash-2', kind: 'bearer', lastSeenAt: later(5) }),
    )
    sessions.create(session({ id: 'session-3', tokenHash: 'hash-3', expiresAt: later(1) }))
    sessions.create(session({ id: 'session-4', tokenHash: 'hash-4', revokedAt: at }))
    expect(
      sessions.listActiveByAccount({ accountId: 'account-1', now: later(100) }).map((s) => s.id),
    ).toEqual(['session-2', 'session-1'])
  })

  test('deleting a profile clears last_profile_id', () => {
    const sessions = createSqliteSessionRepository({ db })
    sessions.create(session({ lastProfileId: 'profile-1' }))
    db.$client.run("DELETE FROM profiles WHERE id = 'profile-1'")
    expect(sessions.findById('session-1')?.lastProfileId).toBeUndefined()
  })
})
