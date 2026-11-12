import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import {
  createFakeSessionTokens,
  createInMemoryAssistantTokens,
  createInMemoryOAuth,
  createInMemoryProfiles,
  sampleProfile,
} from '../../../test/support/auth.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import { createCapturingLogger } from '../../../test/support/logger.ts'
import type { ClientMetadataFetcher, OAuthClient } from '../../core/auth/oauth.ts'
import { type AuthorizationRequest, oauthFactory } from './oauth.ts'

const start = new Date('2026-01-01T00:00:00.000Z')
const minute = 60_000
const day = 24 * 60 * minute
const mcpUrl = 'https://projo.example/mcp'
const callback = 'https://claude.ai/api/mcp/auth_callback'

const claude: OAuthClient = {
  id: 'c1',
  clientId: 'client-abc',
  kind: 'dcr',
  name: 'Claude',
  redirectUris: [callback, 'http://127.0.0.1/callback'],
  createdAt: start,
}

const request = (overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest => ({
  responseType: 'code',
  clientId: 'client-abc',
  redirectUri: callback,
  state: 'xyz',
  codeChallenge: 'S256(verifier)',
  codeChallengeMethod: 'S256',
  scope: 'review offline_access',
  resource: mcpUrl,
  ...overrides,
})

const setup = ({
  clients = [claude],
  metadata = async () => err(appError('oauth/invalid_client', 'unreachable')),
}: { clients?: OAuthClient[]; metadata?: ClientMetadataFetcher } = {}) => {
  const oauth = createInMemoryOAuth(clients)
  const assistants = createInMemoryAssistantTokens()
  const allowed = new Set(['account-1:profile-1'])
  const fetched: string[] = []
  const clock = createManualClock(start)
  const { logger, lines } = createCapturingLogger()
  const service = oauthFactory({
    oauthRepository: oauth.repository,
    assistantTokenRepository: assistants.repository,
    assistantTokens: {
      administers: ({ accountId, profileId }) =>
        allowed.has(`${accountId}:${profileId}`)
          ? ok()
          : err(appError('auth/restricted_profile', 'restricted profile')),
      authenticateAssistant: (found) =>
        found.revokedAt === undefined
          ? ok({ tokenId: found.id, accountId: found.accountId, profileId: found.profileId })
          : err(appError('auth/session_revoked', 'assistant revoked')),
    },
    profileRepository: createInMemoryProfiles([sampleProfile()]).repository,
    clientMetadata: async (url) => {
      fetched.push(url)
      return metadata(url)
    },
    pkce: ({ verifier, challenge }) => challenge === `S256(${verifier})`,
    tokens: createFakeSessionTokens(),
    clock,
    ids: createSequentialIds('oauth-'),
    logger,
  })
  return { service, oauth, assistants, allowed, fetched, clock, lines }
}

type World = ReturnType<typeof setup>

const allow = (world: World, overrides: Partial<AuthorizationRequest> = {}) =>
  world.service.decide({
    request: request(overrides),
    decision: 'allow',
    mcpUrl,
    accountId: 'account-1',
    profileId: 'profile-1',
  })

const codeOf = (redirectTo: string): string =>
  new URL(redirectTo).searchParams.get('code') ?? 'no code'

const authorize = async (world: World): Promise<string> => {
  const decided = await allow(world)
  return decided.ok ? codeOf(decided.value.redirectTo) : 'refused'
}

const exchange = (
  world: World,
  code: string,
  overrides: Partial<{ codeVerifier: string; redirectUri: string; clientId: string }> = {},
) =>
  world.service.token({
    grantType: 'authorization_code',
    code,
    codeVerifier: 'verifier',
    redirectUri: callback,
    clientId: 'client-abc',
    ...overrides,
  })

/** Authorizes then exchanges the code: access `token-2`, refresh `token-3`. */
const connect = async (world: World) => exchange(world, await authorize(world))

const invalidGrant = (message: string) => ({
  ok: false,
  error: { code: 'oauth/invalid_grant', message },
})

describe('dynamic client registration', () => {
  test('without redirect URI: oauth/invalid_request', () => {
    expect(setup().service.register({ redirectUris: [] })).toMatchObject({
      ok: false,
      error: { code: 'oauth/invalid_request' },
    })
  })

  test('plain HTTP off loopback, or a fragment: oauth/invalid_redirect_uri', () => {
    const world = setup({ clients: [] })
    for (const uri of ['http://evil.example/cb', 'https://app.example/cb#frag']) {
      expect(world.service.register({ redirectUris: [callback, uri] })).toMatchObject({
        ok: false,
        error: { code: 'oauth/invalid_redirect_uri', context: { redirectUri: uri } },
      })
    }
    expect(world.oauth.clients.size).toBe(0)
  })

  test('a client gets a generated client_id; its name trimmed, "MCP client" when blank', () => {
    const world = setup({ clients: [] })
    expect(world.service.register({ clientName: '  Claude  ', redirectUris: [callback] })).toEqual(
      ok({
        id: 'oauth-1',
        clientId: 'token-1',
        kind: 'dcr',
        name: 'Claude',
        redirectUris: [callback],
        createdAt: start,
      }),
    )
    const blank = world.service.register({ clientName: ' ', redirectUris: [callback] })
    expect(blank.ok && blank.value.name).toBe('MCP client')
  })
})

describe('consent screen', () => {
  const consent = (
    world: World,
    overrides: Partial<AuthorizationRequest> = {},
    { profileId }: { profileId: string | undefined } = { profileId: 'profile-1' },
  ) =>
    world.service.consent({
      request: request(overrides),
      mcpUrl,
      accountId: 'account-1',
      profileId,
    })

  test('the client, where it sends back, and whether this profile may allow', async () => {
    expect(await consent(setup())).toEqual(
      ok({
        client: { name: 'Claude', redirectHost: 'claude.ai', loopback: false },
        canAuthorize: true,
        profile: { id: 'profile-1', name: 'Léo' },
      }),
    )
  })

  test('without a profile, or on a restricted one, it cannot be allowed', async () => {
    const world = setup()
    const without = await consent(world, {}, { profileId: undefined })
    expect(without.ok && without.value.canAuthorize).toBe(false)
    expect(without.ok && 'profile' in without.value).toBe(false)
    world.allowed.clear()
    const restricted = await consent(world)
    expect(restricted.ok && restricted.value).toMatchObject({
      canAuthorize: false,
      profile: { id: 'profile-1' },
    })
  })

  test('an unknown client: oauth/invalid_client', async () => {
    expect(await consent(setup(), { clientId: 'stranger' })).toMatchObject({
      ok: false,
      error: { code: 'oauth/invalid_client', context: { clientId: 'stranger' } },
    })
  })

  test('a redirect the client did not declare: oauth/invalid_redirect_uri', async () => {
    expect(await consent(setup(), { redirectUri: 'https://evil.example/cb' })).toMatchObject({
      ok: false,
      error: { code: 'oauth/invalid_redirect_uri' },
    })
  })

  test('a loopback redirect matches on any port', async () => {
    const result = await consent(setup(), { redirectUri: 'http://127.0.0.1:53123/callback' })
    expect(result.ok && result.value.client).toEqual({
      name: 'Claude',
      redirectHost: '127.0.0.1:53123',
      loopback: true,
    })
  })

  test('not a code flow, plain PKCE, another resource: oauth/invalid_request', async () => {
    const world = setup()
    for (const [overrides, reason] of [
      [{ responseType: 'token' }, 'response_type must be code'],
      [{ codeChallengeMethod: 'plain' }, 'PKCE S256 is required'],
      [{ resource: 'https://other.example/mcp' }, 'unknown resource'],
    ] as const) {
      expect(await consent(world, overrides)).toMatchObject({
        ok: false,
        error: { code: 'oauth/invalid_request', context: { reason } },
      })
    }
  })

  test('the resource may carry a trailing slash, or be left out', async () => {
    const world = setup()
    expect((await consent(world, { resource: `${mcpUrl}/` })).ok).toBe(true)
    const { resource: _resource, ...withoutResource } = request()
    expect(
      (
        await world.service.consent({
          request: withoutResource,
          mcpUrl,
          accountId: 'account-1',
          profileId: 'profile-1',
        })
      ).ok,
    ).toBe(true)
  })
})

describe('Client ID Metadata Documents', () => {
  const documentUrl = 'https://claude.ai/oauth/client.json'
  const metadata: ClientMetadataFetcher = async (url) =>
    ok({ clientId: url, redirectUris: [callback, 'http://evil.example/cb'] })

  test('read once, kept a day with the redirects that are acceptable, named after its host', async () => {
    const world = setup({ clients: [], metadata })
    const consent = () =>
      world.service.consent({
        request: request({ clientId: documentUrl }),
        mcpUrl,
        accountId: 'account-1',
        profileId: 'profile-1',
      })
    expect((await consent()).ok).toBe(true)
    expect([...world.oauth.clients.values()]).toEqual([
      {
        id: 'oauth-1',
        clientId: documentUrl,
        kind: 'cimd',
        name: 'claude.ai',
        redirectUris: [callback],
        createdAt: start,
        fetchedAt: start,
      },
    ])
    world.clock.advance(day - 1)
    await consent()
    expect(world.fetched).toEqual([documentUrl])

    world.clock.advance(1)
    await consent()
    expect(world.fetched).toEqual([documentUrl, documentUrl])
    expect(world.oauth.clients.get('oauth-1')).toMatchObject({
      createdAt: start,
      fetchedAt: new Date(start.getTime() + day),
    })
  })

  test('a document that cannot be read: oauth/invalid_client', async () => {
    const world = setup({ clients: [] })
    expect(
      await world.service.consent({
        request: request({ clientId: documentUrl }),
        mcpUrl,
        accountId: 'account-1',
        profileId: 'profile-1',
      }),
    ).toMatchObject({ ok: false, error: { code: 'oauth/invalid_client' } })
    expect(world.oauth.clients.size).toBe(0)
  })
})

describe('the decision', () => {
  test('deny: back to the client with access_denied, no code', async () => {
    const world = setup()
    const result = await world.service.decide({
      request: request(),
      decision: 'deny',
      mcpUrl,
      accountId: 'account-1',
      profileId: undefined,
    })
    expect(result).toEqual(ok({ redirectTo: `${callback}?error=access_denied&state=xyz` }))
    expect(world.oauth.codes.size).toBe(0)
  })

  test('allow: a one-minute code bound to the client, redirect, PKCE challenge and scope', async () => {
    const world = setup()
    expect(await allow(world)).toEqual(ok({ redirectTo: `${callback}?code=token-1&state=xyz` }))
    expect([...world.oauth.codes.values()]).toEqual([
      {
        codeHash: 'h(token-1)',
        clientId: 'c1',
        accountId: 'account-1',
        profileId: 'profile-1',
        redirectUri: callback,
        codeChallenge: 'S256(verifier)',
        scope: 'review offline_access',
        expiresAt: new Date(start.getTime() + minute),
      },
    ])
  })

  test('the granted scope is always review, offline_access only when asked', async () => {
    const world = setup()
    await allow(world, { scope: 'admin everything' })
    expect([...world.oauth.codes.values()][0]?.scope).toBe('review')
  })

  test('allow without a profile, or on a profile the account cannot administer: access_denied', async () => {
    const world = setup()
    const withoutProfile = await world.service.decide({
      request: request(),
      decision: 'allow',
      mcpUrl,
      accountId: 'account-1',
      profileId: undefined,
    })
    expect(withoutProfile).toMatchObject({ ok: false, error: { code: 'oauth/access_denied' } })
    world.allowed.clear()
    expect(await allow(world)).toMatchObject({ ok: false, error: { code: 'oauth/access_denied' } })
    expect(world.oauth.codes.size).toBe(0)
  })

  test('an invalid request is refused before deciding anything', async () => {
    const world = setup()
    expect(await allow(world, { codeChallengeMethod: 'plain' })).toMatchObject({
      ok: false,
      error: { code: 'oauth/invalid_request' },
    })
    expect(world.oauth.codes.size).toBe(0)
  })
})

describe('exchanging the code', () => {
  test('an assistant connection, an hour-long access token and a 90-day refresh token', async () => {
    const world = setup()
    expect(await connect(world)).toEqual(
      ok({
        access_token: 'token-2',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'token-3',
        scope: 'review offline_access',
      }),
    )
    expect([...world.assistants.tokens.values()]).toEqual([
      {
        id: 'oauth-1',
        accountId: 'account-1',
        profileId: 'profile-1',
        kind: 'oauth',
        clientId: 'c1',
        name: 'Claude',
        createdAt: start,
      },
    ])
    expect([...world.oauth.tokens.values()]).toEqual([
      {
        tokenHash: 'h(token-2)',
        assistantId: 'oauth-1',
        kind: 'access',
        expiresAt: new Date(start.getTime() + 60 * minute),
      },
      {
        tokenHash: 'h(token-3)',
        assistantId: 'oauth-1',
        kind: 'refresh',
        expiresAt: new Date(start.getTime() + 90 * day),
      },
    ])
    expect(world.oauth.touched).toEqual([{ id: 'c1', at: start }])
  })

  test('a code works once', async () => {
    const world = setup()
    const code = await authorize(world)
    expect((await exchange(world, code)).ok).toBe(true)
    expect(await exchange(world, code)).toMatchObject(invalidGrant('unknown or used code'))
  })

  test('an unknown code', async () => {
    expect(await exchange(setup(), 'forged')).toMatchObject(invalidGrant('unknown or used code'))
  })

  test('a code a minute old', async () => {
    const world = setup()
    const code = await authorize(world)
    world.clock.advance(minute)
    expect(await exchange(world, code)).toMatchObject(invalidGrant('expired code'))
  })

  test('a code presented by another client, to another redirect, or with a wrong verifier', async () => {
    for (const [overrides, message] of [
      [{ clientId: 'someone-else' }, 'the code was issued to another client'],
      [{ redirectUri: 'http://127.0.0.1/callback' }, 'redirect_uri mismatch'],
      [{ codeVerifier: 'guess' }, 'PKCE verification failed'],
    ] as const) {
      const world = setup()
      expect(await exchange(world, await authorize(world), overrides)).toMatchObject(
        invalidGrant(message),
      )
      expect(world.assistants.tokens.size).toBe(0)
    }
  })

  test('an account no longer allowed between consent and exchange', async () => {
    const world = setup()
    const code = await authorize(world)
    world.allowed.clear()
    expect(await exchange(world, code)).toMatchObject(invalidGrant('access no longer allowed'))
    expect(world.assistants.tokens.size).toBe(0)
  })
})

describe('refreshing', () => {
  const refresh = (world: World, refreshToken: string, clientId?: string) =>
    world.service.token({
      grantType: 'refresh_token',
      refreshToken,
      ...(clientId === undefined ? {} : { clientId }),
    })

  test('a new pair for the same connection, the old refresh token rotated', async () => {
    const world = setup()
    await connect(world)
    world.clock.advance(day)
    expect(await refresh(world, 'token-3', 'client-abc')).toEqual(
      ok({
        access_token: 'token-4',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'token-5',
        scope: 'review offline_access',
      }),
    )
    const later = new Date(start.getTime() + day)
    expect(world.oauth.tokens.get('h(token-3)')?.rotatedAt).toEqual(later)
    expect(world.oauth.tokens.get('h(token-5)')).toMatchObject({
      assistantId: 'oauth-1',
      kind: 'refresh',
    })
    expect(world.oauth.touched.at(-1)).toEqual({ id: 'c1', at: later })
  })

  test('the client id may be left out', async () => {
    const world = setup()
    await connect(world)
    expect((await refresh(world, 'token-3')).ok).toBe(true)
  })

  test('a refresh token used twice revokes the connection', async () => {
    const world = setup()
    await connect(world)
    await refresh(world, 'token-3')
    expect(await refresh(world, 'token-3')).toMatchObject(
      invalidGrant('refresh token already used'),
    )
    expect(world.assistants.tokens.get('oauth-1')?.revokedAt).toEqual(start)
    expect(world.lines).toContainEqual(
      expect.objectContaining({ level: 'warn', fields: { assistantTokenId: 'oauth-1' } }),
    )
    expect(await refresh(world, 'token-5')).toMatchObject(invalidGrant('assistant revoked'))
  })

  test('an unknown token, or an access token, is no refresh token', async () => {
    const world = setup()
    await connect(world)
    expect(await refresh(world, 'forged')).toMatchObject(invalidGrant('unknown refresh token'))
    expect(await refresh(world, 'token-2')).toMatchObject(invalidGrant('unknown refresh token'))
  })

  test('after 90 days', async () => {
    const world = setup()
    await connect(world)
    world.clock.advance(90 * day)
    expect(await refresh(world, 'token-3')).toMatchObject(invalidGrant('expired refresh token'))
  })

  test('presented by another client', async () => {
    const world = setup()
    await connect(world)
    expect(await refresh(world, 'token-3', 'someone-else')).toMatchObject(
      invalidGrant('the refresh token was issued to another client'),
    )
  })

  test('an account no longer allowed', async () => {
    const world = setup()
    await connect(world)
    world.allowed.clear()
    expect(await refresh(world, 'token-3')).toMatchObject(invalidGrant('access no longer allowed'))
  })
})

describe('authenticating an access token', () => {
  test('the assistant principal', async () => {
    const world = setup()
    await connect(world)
    expect(world.service.authenticateAccess('token-2')).toEqual(
      ok({ tokenId: 'oauth-1', accountId: 'account-1', profileId: 'profile-1' }),
    )
  })

  test('an unknown token, or a refresh token: auth/unauthenticated', async () => {
    const world = setup()
    await connect(world)
    for (const token of ['forged', 'token-3']) {
      expect(world.service.authenticateAccess(token)).toMatchObject({
        ok: false,
        error: { code: 'auth/unauthenticated' },
      })
    }
  })

  test('after an hour: auth/session_expired', async () => {
    const world = setup()
    await connect(world)
    world.clock.advance(60 * minute)
    expect(world.service.authenticateAccess('token-2')).toMatchObject({
      ok: false,
      error: { code: 'auth/session_expired' },
    })
  })

  test('a token whose connection is gone: auth/unauthenticated', () => {
    const world = setup()
    world.oauth.repository.createToken({
      tokenHash: 'h(orphan)',
      assistantId: 'gone',
      kind: 'access',
      expiresAt: new Date(start.getTime() + minute),
    })
    expect(world.service.authenticateAccess('orphan')).toMatchObject({
      ok: false,
      error: { code: 'auth/unauthenticated' },
    })
  })

  test('a revoked connection: its own refusal', async () => {
    const world = setup()
    await connect(world)
    world.assistants.repository.revoke({ id: 'oauth-1', revokedAt: start })
    expect(world.service.authenticateAccess('token-2')).toMatchObject({
      ok: false,
      error: { code: 'auth/session_revoked' },
    })
  })
})

test('the purge drops what expired and registrations unused for 30 days', () => {
  const world = setup()
  world.service.purge()
  expect(world.oauth.purged).toEqual([
    { now: start, unusedBefore: new Date(start.getTime() - 30 * day) },
  ])
})
