import { beforeEach, describe, expect, test } from 'bun:test'

import { insertAccount, insertProfile } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { AssistantTokenRepository } from '../../core/auth/assistant-token.ts'
import type { OAuthClient, OAuthRepository } from '../../core/auth/oauth.ts'
import { createSqliteAssistantTokenRepository } from './assistant-token-repository.ts'
import { createSqliteOAuthRepository } from './oauth-repository.ts'

const now = new Date('2026-06-01T10:00:00.000Z')
const day = 24 * 60 * 60_000
const unusedBefore = new Date(now.getTime() - 30 * day)
const daysAgo = (days: number) => new Date(now.getTime() - days * day)

let oauth: OAuthRepository
let assistants: AssistantTokenRepository

beforeEach(() => {
  const db = createTestDatabase()
  insertAccount(db)
  insertProfile(db, 'account-1', 'profile-1')
  oauth = createSqliteOAuthRepository({ db })
  assistants = createSqliteAssistantTokenRepository({ db })
})

const client = (id: string, overrides: Partial<OAuthClient> = {}): OAuthClient =>
  oauth.saveClient({
    id,
    clientId: `client-${id}`,
    kind: 'dcr',
    name: id,
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    createdAt: daysAgo(40),
    ...overrides,
  })

const connect = (clientId: string, id = `assistant-of-${clientId}`) =>
  assistants.create({
    id,
    accountId: 'account-1',
    profileId: 'profile-1',
    kind: 'oauth',
    clientId,
    name: clientId,
    createdAt: daysAgo(40),
  })

describe('OAuth purge (§27.3)', () => {
  test('a registration unused for 30 days goes, by last use or else by creation', () => {
    client('never-used')
    client('used-long-ago', { lastUsedAt: daysAgo(31) })
    client('used-lately', { createdAt: daysAgo(90), lastUsedAt: daysAgo(29) })
    client('recent', { createdAt: daysAgo(29) })
    oauth.purge({ now, unusedBefore })
    expect(
      ['never-used', 'used-long-ago', 'used-lately', 'recent'].map(
        (id) => oauth.findClientById(id) !== undefined,
      ),
    ).toEqual([false, false, true, true])
  })

  test('a registration with a live connection stays; one whose connections are revoked goes', () => {
    client('connected')
    connect('connected')
    client('revoked')
    connect('revoked')
    assistants.revoke({ id: 'assistant-of-revoked', revokedAt: daysAgo(35) })
    oauth.purge({ now, unusedBefore })
    expect(oauth.findClientById('connected')).toBeDefined()
    expect(oauth.findClientById('revoked')).toBeUndefined()
  })

  test('a Client ID Metadata Document client is never purged', () => {
    client('cimd', { kind: 'cimd', clientId: 'https://claude.ai/oauth/client.json' })
    oauth.purge({ now, unusedBefore })
    expect(oauth.findClientById('cimd')).toBeDefined()
  })

  test('expired codes and tokens go, live ones stay', () => {
    client('c1')
    connect('c1', 'a1')
    for (const [codeHash, expiresAt] of [
      ['old-code', daysAgo(1)],
      ['live-code', new Date(now.getTime() + 60_000)],
    ] as const) {
      oauth.createCode({
        codeHash,
        clientId: 'c1',
        accountId: 'account-1',
        profileId: 'profile-1',
        redirectUri: 'https://claude.ai/api/mcp/auth_callback',
        codeChallenge: 'challenge',
        scope: 'review',
        expiresAt,
      })
    }
    for (const [tokenHash, expiresAt] of [
      ['old-token', daysAgo(1)],
      ['live-token', new Date(now.getTime() + day)],
    ] as const) {
      oauth.createToken({
        tokenHash,
        assistantId: 'a1',
        kind: 'refresh',
        scope: 'review',
        expiresAt,
      })
    }
    oauth.purge({ now, unusedBefore })
    expect(oauth.consumeCode({ codeHash: 'old-code', usedAt: now })).toBeUndefined()
    expect(oauth.consumeCode({ codeHash: 'live-code', usedAt: now })).toBeDefined()
    expect(oauth.findToken('old-token')).toBeUndefined()
    expect(oauth.findToken('live-token')).toBeDefined()
  })
})

describe('OAuth tokens', () => {
  test('keep the scope granted at consent', () => {
    client('c1')
    connect('c1', 'a1')
    oauth.createToken({
      tokenHash: 'h',
      assistantId: 'a1',
      kind: 'refresh',
      scope: 'review',
      expiresAt: new Date(now.getTime() + day),
    })
    expect(oauth.findToken('h')).toEqual({
      tokenHash: 'h',
      assistantId: 'a1',
      kind: 'refresh',
      scope: 'review',
      expiresAt: new Date(now.getTime() + day),
    })
  })

  test('a refresh token is rotated once', () => {
    client('c1')
    connect('c1', 'a1')
    oauth.createToken({
      tokenHash: 'h',
      assistantId: 'a1',
      kind: 'refresh',
      scope: 'review offline_access',
      expiresAt: new Date(now.getTime() + day),
    })
    expect(oauth.markRotated({ tokenHash: 'h', at: now })).toBe(true)
    expect(oauth.markRotated({ tokenHash: 'h', at: now })).toBe(false)
    expect(oauth.findToken('h')?.rotatedAt).toEqual(now)
  })
})
