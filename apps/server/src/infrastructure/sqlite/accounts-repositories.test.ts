import { beforeEach, describe, expect, test } from 'bun:test'

import { count, eq } from 'drizzle-orm'

import { sampleAccount, sampleProfile } from '../../../test/support/auth.ts'
import { insertItem, insertLibrary, insertSource } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Session } from '../../core/auth/session.ts'
import { createSqliteAccountActivity } from './account-activity.ts'
import { createSqliteAccountRepository } from './account-repository.ts'
import type { Db } from './database.ts'
import { createSqliteInvitationRepository } from './invitation-repository.ts'
import { createSqliteProfileRepository } from './profile-repository.ts'
import { accounts, invitations, profileLibraries, profiles, sessions } from './schema/accounts.ts'
import { libraries } from './schema/libraries.ts'
import {
  playbackProgress,
  playbackSessions,
  trackPreferences,
  watchlist,
} from './schema/playback.ts'
import { createSqliteSessionRepository } from './session-repository.ts'

const at = new Date('2026-02-01T10:00:00.000Z')

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  accountId: 'account-1',
  kind: 'cookie',
  tokenHash: 'hash-1',
  deviceName: 'Firefox · macOS',
  userAgent: 'Mozilla/5.0',
  createdAt: at,
  lastSeenAt: at,
  expiresAt: new Date('2026-03-01T00:00:00.000Z'),
  ...overrides,
})

const rows = (db: Db, table: typeof profiles | typeof sessions | typeof accounts) =>
  db.select({ value: count() }).from(table).get()?.value ?? 0

let db: Db
let accountRepo: ReturnType<typeof createSqliteAccountRepository>
let profileRepo: ReturnType<typeof createSqliteProfileRepository>

beforeEach(() => {
  db = createTestDatabase()
  accountRepo = createSqliteAccountRepository({ db })
  profileRepo = createSqliteProfileRepository({ db })
  insertLibrary(db, { id: 'films', rootPath: '/films' })
  insertLibrary(db, { id: 'anime', rootPath: '/anime' })
  expect(accountRepo.create({ account: sampleAccount(), profile: sampleProfile() })).toBe('created')
})

describe('SQLite account repository', () => {
  test('create is atomic and case-insensitive on the username', () => {
    expect(
      accountRepo.create({
        account: sampleAccount({ id: 'account-2', username: 'LEO' }),
        profile: sampleProfile({ id: 'profile-2', accountId: 'account-2' }),
      }),
    ).toBe('username_taken')
    expect(rows(db, profiles)).toBe(1)
  })

  test('roles, activation, password, enabled admin count', () => {
    accountRepo.create({
      account: sampleAccount({ id: 'account-2', username: 'zoe', role: 'user' }),
      profile: sampleProfile({ id: 'profile-2', accountId: 'account-2' }),
    })
    expect(accountRepo.countEnabledAdmins()).toBe(1)
    accountRepo.setRole({ id: 'account-2', role: 'admin' })
    expect(accountRepo.countEnabledAdmins()).toBe(2)
    accountRepo.setDisabled({ id: 'account-2', disabledAt: at })
    expect(accountRepo.countEnabledAdmins()).toBe(1)
    expect(accountRepo.findById('account-2')?.disabledAt).toEqual(at)
    accountRepo.setDisabled({ id: 'account-2', disabledAt: undefined })
    expect(accountRepo.findById('account-2')?.disabledAt).toBeUndefined()
    accountRepo.setPasswordHash({ id: 'account-2', passwordHash: 'new' })
    expect(accountRepo.findById('account-2')?.passwordHash).toBe('new')
    expect(accountRepo.list().map((account) => account.username)).toEqual(['Leo', 'zoe'])
  })

  test('deleting an account removes everything that belongs to it (§6.1)', () => {
    accountRepo.create({
      account: sampleAccount({ id: 'account-2', username: 'zoe', role: 'user' }),
      profile: sampleProfile({
        id: 'profile-2',
        accountId: 'account-2',
        libraryAccess: 'selected',
        libraryIds: ['films'],
      }),
    })
    createSqliteSessionRepository({ db }).create(
      session({ id: 's2', accountId: 'account-2', tokenHash: 'h2', lastProfileId: 'profile-2' }),
    )
    insertItem(db, { id: 'movie', kind: 'movie' })
    insertSource(db, { id: 'src', itemId: 'movie', libraryId: 'films', rootId: 'films-root' })
    const iso = at.toISOString()
    db.insert(playbackProgress)
      .values({ profileId: 'profile-2', itemId: 'movie', lastPlayedAt: iso })
      .run()
    db.insert(watchlist).values({ profileId: 'profile-2', itemId: 'movie', addedAt: iso }).run()
    db.insert(trackPreferences)
      .values({ profileId: 'profile-2', itemId: 'movie', updatedAt: iso })
      .run()
    db.insert(playbackSessions)
      .values({
        id: 'p1',
        profileId: 'profile-2',
        sessionId: 's2',
        sourceId: 'src',
        itemId: 'movie',
        mode: 'direct',
        startedAt: iso,
        lastHeartbeatAt: iso,
      })
      .run()
    db.insert(invitations)
      .values({
        id: 'i1',
        tokenHash: 't1',
        createdBy: 'account-1',
        expiresAt: iso,
        usedAt: iso,
        usedByAccountId: 'account-2',
      })
      .run()

    accountRepo.delete('account-2')

    expect(accountRepo.findById('account-2')).toBeUndefined()
    expect(
      db
        .select()
        .from(profiles)
        .all()
        .map((row) => row.id),
    ).toEqual(['profile-1'])
    expect(db.select().from(sessions).all()).toEqual([])
    expect(db.select().from(profileLibraries).all()).toEqual([])
    expect(db.select().from(playbackProgress).all()).toEqual([])
    expect(db.select().from(watchlist).all()).toEqual([])
    expect(db.select().from(trackPreferences).all()).toEqual([])
    expect(db.select().from(playbackSessions).all()).toEqual([])
    // The invitation history stays, without its account.
    expect(db.select().from(invitations).get()?.usedByAccountId).toBeNull()
  })
})

describe('SQLite profile repository', () => {
  test('libraries of a selected profile, replaced on update, cleared for all', () => {
    const kid = sampleProfile({
      id: 'kid',
      libraryAccess: 'selected',
      libraryIds: ['films', 'anime'],
      maxContentRating: '10',
      pinHash: 'hashed:1234',
    })
    expect(profileRepo.create(kid, { maxPerAccount: 5 })).toBe(true)
    expect(profileRepo.findById('kid')).toEqual({ ...kid, libraryIds: ['anime', 'films'] })
    // Same creation date: ordered by id.
    expect(profileRepo.listByAccount('account-1').map((p) => p.libraryIds)).toEqual([
      ['anime', 'films'],
      [],
    ])

    profileRepo.update({ ...kid, libraryIds: ['anime'], name: 'Enfants' })
    expect(profileRepo.findById('kid')).toMatchObject({ name: 'Enfants', libraryIds: ['anime'] })

    const { maxContentRating: _rating, pinHash: _pin, ...open } = kid
    profileRepo.update({ ...open, libraryAccess: 'all', libraryIds: [] })
    const reread = profileRepo.findById('kid')
    expect(reread).toMatchObject({ libraryAccess: 'all', libraryIds: [] })
    expect(reread?.maxContentRating).toBeUndefined()
    expect(reread?.pinHash).toBeUndefined()
    expect(db.select().from(profileLibraries).all()).toEqual([])
  })

  test('a deleted library leaves the selection; unknown ids are reported', () => {
    profileRepo.create(
      sampleProfile({ id: 'kid', libraryAccess: 'selected', libraryIds: ['films', 'anime'] }),
      { maxPerAccount: 5 },
    )
    db.delete(libraries).where(eq(libraries.id, 'films')).run()
    expect(profileRepo.findById('kid')?.libraryIds).toEqual(['anime'])
    expect(profileRepo.unknownLibraryIds(['anime', 'films', 'films'])).toEqual(['films'])
    profileRepo.delete('kid')
    expect(profileRepo.findById('kid')).toBeUndefined()
  })
})

describe('SQLite profile limit', () => {
  test('the count and the insert share a transaction: refused at the limit', () => {
    expect(profileRepo.create(sampleProfile({ id: 'p2' }), { maxPerAccount: 2 })).toBe(true)
    expect(profileRepo.create(sampleProfile({ id: 'p3' }), { maxPerAccount: 2 })).toBe(false)
    expect(profileRepo.findById('p3')).toBeUndefined()
  })
})

describe('SQLite session repository', () => {
  test('revokeAllByAccount spares the current session and other accounts', () => {
    const repo = createSqliteSessionRepository({ db })
    accountRepo.create({
      account: sampleAccount({ id: 'account-2', username: 'zoe' }),
      profile: sampleProfile({ id: 'profile-2', accountId: 'account-2' }),
    })
    repo.create(session({ id: 'a', tokenHash: 'a' }))
    repo.create(session({ id: 'b', tokenHash: 'b' }))
    repo.create(session({ id: 'c', tokenHash: 'c', accountId: 'account-2' }))
    repo.revokeAllByAccount({ accountId: 'account-1', revokedAt: at, exceptId: 'a' })
    expect(repo.findById('a')?.revokedAt).toBeUndefined()
    expect(repo.findById('b')?.revokedAt).toEqual(at)
    expect(repo.findById('c')?.revokedAt).toBeUndefined()
  })
})

describe('SQLite invitation repository', () => {
  const invitation = {
    id: 'inv-1',
    tokenHash: 'th',
    createdBy: 'account-1',
    expiresAt: new Date('2026-02-08T10:00:00.000Z'),
  }
  const newcomer = {
    account: sampleAccount({ id: 'account-2', username: 'zoe', role: 'user' as const }),
    profile: sampleProfile({ id: 'profile-2', accountId: 'account-2', name: 'zoe' }),
  }

  test('accept creates the account once, then the invitation is used', () => {
    const repo = createSqliteInvitationRepository({ db })
    repo.create(invitation)
    expect(repo.accept({ tokenHash: 'nope', ...newcomer, at })).toBe('not_found')
    expect(repo.accept({ tokenHash: 'th', ...newcomer, at })).toBe('accepted')
    expect(accountRepo.findById('account-2')).toMatchObject({ username: 'zoe', role: 'user' })
    expect(profileRepo.listByAccount('account-2')).toHaveLength(1)
    expect(
      repo.accept({
        tokenHash: 'th',
        account: { ...newcomer.account, id: 'account-3', username: 'other' },
        profile: { ...newcomer.profile, id: 'profile-3', accountId: 'account-3' },
        at,
      }),
    ).toBe('used')
    expect(repo.list()).toEqual([
      {
        ...invitation,
        usedAt: at,
        usedByAccountId: 'account-2',
        createdByUsername: 'Leo',
        usedByUsername: 'zoe',
      },
    ])
  })

  test('expired, or username taken: nothing is written', () => {
    const repo = createSqliteInvitationRepository({ db })
    repo.create(invitation)
    expect(repo.accept({ tokenHash: 'th', ...newcomer, at: invitation.expiresAt })).toBe('expired')
    expect(
      repo.accept({
        tokenHash: 'th',
        ...newcomer,
        account: { ...newcomer.account, username: 'LEO' },
        at,
      }),
    ).toBe('username_taken')
    expect(rows(db, accounts)).toBe(1)
    expect(repo.findByTokenHash('th')?.usedAt).toBeUndefined()
    repo.delete('inv-1')
    expect(repo.list()).toEqual([])
  })
})

describe('SQLite account activity', () => {
  test('last activity and device, open sessions, profiles playing', () => {
    const repo = createSqliteSessionRepository({ db })
    repo.create(session({ id: 'old', tokenHash: 'o', lastSeenAt: at, deviceName: 'TV' }))
    repo.create(
      session({
        id: 'recent',
        tokenHash: 'r',
        lastSeenAt: new Date('2026-02-02T10:00:00.000Z'),
        deviceName: 'iPhone',
        revokedAt: at,
      }),
    )
    insertItem(db, { id: 'movie', kind: 'movie' })
    insertSource(db, { id: 'src', itemId: 'movie', libraryId: 'films', rootId: 'films-root' })
    const now = new Date('2026-02-02T12:00:00.000Z')
    db.insert(playbackSessions)
      .values({
        id: 'p1',
        profileId: 'profile-1',
        sessionId: 'old',
        sourceId: 'src',
        itemId: 'movie',
        mode: 'direct',
        startedAt: now.toISOString(),
        lastHeartbeatAt: new Date(now.getTime() - 10_000).toISOString(),
      })
      .run()

    const activity = createSqliteAccountActivity({ db })({ now })
    expect(activity.get('account-1')).toEqual({
      accountId: 'account-1',
      lastSeenAt: new Date('2026-02-02T10:00:00.000Z'),
      lastDeviceName: 'iPhone',
      activeSessions: 1,
      playingProfileIds: ['profile-1'],
    })
    // A stale heartbeat is not "en lecture".
    const later = createSqliteAccountActivity({ db })({ now: new Date(now.getTime() + 3_600_000) })
    expect(later.get('account-1')?.playingProfileIds).toEqual([])
  })
})
