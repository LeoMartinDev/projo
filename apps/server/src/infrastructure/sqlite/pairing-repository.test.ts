import { beforeEach, describe, expect, test } from 'bun:test'

import { sampleAccount, sampleProfile } from '../../../test/support/auth.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Pairing, PairingRepository } from '../../core/auth/pairing.ts'
import type { Session } from '../../core/auth/session.ts'
import { createSqliteAccountRepository } from './account-repository.ts'
import type { Db } from './database.ts'
import { createSqlitePairingRepository } from './pairing-repository.ts'
import { createSqliteSessionRepository } from './session-repository.ts'

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

const pairing = (overrides: Partial<Pairing> = {}): Pairing => ({
  id: 'pairing-1',
  accountId: 'account-1',
  createdBySessionId: 'session-1',
  codeHash: 'code-hash-1',
  createdAt: at,
  expiresAt: later(300_000),
  ...overrides,
})

let db: Db
let repo: PairingRepository
beforeEach(() => {
  db = createTestDatabase()
  createSqliteAccountRepository({ db }).create({
    account: sampleAccount(),
    profile: sampleProfile(),
  })
  createSqliteSessionRepository({ db }).create(session())
  repo = createSqlitePairingRepository({ db })
})

describe('SQLite pairing repository', () => {
  test('round-trips a pairing; finds the most recent one by code hash', () => {
    repo.create(pairing())
    expect(repo.findByCodeHash('code-hash-1')).toEqual(pairing())
    repo.create(pairing({ id: 'pairing-2', createdAt: later(1_000), expiresAt: later(301_000) }))
    expect(repo.findByCodeHash('code-hash-1')?.id).toBe('pairing-2')
    expect(repo.findByCodeHash('other')).toBeUndefined()
  })

  test('claims once', () => {
    repo.create(pairing())
    createSqliteSessionRepository({ db }).create(
      session({ id: 'session-2', kind: 'bearer', tokenHash: 'hash-2' }),
    )
    expect(
      repo.claim({ id: 'pairing-1', claimedAt: later(1), claimedSessionId: 'session-2' }),
    ).toBe(true)
    expect(
      repo.claim({ id: 'pairing-1', claimedAt: later(2), claimedSessionId: 'session-2' }),
    ).toBe(false)
    expect(repo.findByCodeHash('code-hash-1')).toEqual(
      pairing({ claimedAt: later(1), claimedSessionId: 'session-2' }),
    )
  })

  test('lists the live pairings of an account, deletes the expired ones', () => {
    repo.create(pairing())
    repo.create(pairing({ id: 'pairing-2', codeHash: 'h2', expiresAt: later(10) }))
    repo.create(pairing({ id: 'pairing-3', codeHash: 'h3', claimedAt: later(1) }))
    expect(
      repo.listLiveByAccount({ accountId: 'account-1', now: later(5) }).map((p) => p.id),
    ).toEqual(['pairing-2', 'pairing-1'])
    expect(
      repo.listLiveByAccount({ accountId: 'account-1', now: later(10) }).map((p) => p.id),
    ).toEqual(['pairing-1'])
    repo.deleteExpiredBefore(later(11))
    expect(repo.findByCodeHash('h2')).toBeUndefined()
    expect(repo.findByCodeHash('code-hash-1')).toBeDefined()
  })

  test('goes with its account', () => {
    repo.create(pairing())
    createSqliteAccountRepository({ db }).delete('account-1')
    expect(repo.findByCodeHash('code-hash-1')).toBeUndefined()
  })
})
