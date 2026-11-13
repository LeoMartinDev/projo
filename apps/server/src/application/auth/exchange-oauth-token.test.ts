import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  allow,
  authorize,
  codeOf,
  connect,
  createOAuthWorld as setup,
  day,
  exchange,
  invalidGrant,
  minute,
  start,
  type World,
} from '../../../test/support/oauth-world.ts'

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
        scope: 'review offline_access',
        expiresAt: new Date(start.getTime() + 60 * minute),
      },
      {
        tokenHash: 'h(token-3)',
        assistantId: 'oauth-1',
        kind: 'refresh',
        scope: 'review offline_access',
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
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({ assistantTokenId: 'oauth-1' }),
      }),
    )
    expect(await refresh(world, 'token-5')).toMatchObject(invalidGrant('assistant revoked'))
  })

  test('an unknown token, or an access token, is no refresh token', async () => {
    const world = setup()
    await connect(world)
    expect(await refresh(world, 'forged')).toMatchObject(invalidGrant('unknown refresh token'))
    expect(await refresh(world, 'token-2')).toMatchObject(invalidGrant('unknown refresh token'))
  })

  test('after 90 days, and again on retry: expired, the connection kept', async () => {
    const world = setup()
    await connect(world)
    world.clock.advance(90 * day)
    expect(await refresh(world, 'token-3')).toMatchObject(invalidGrant('expired refresh token'))
    expect(await refresh(world, 'token-3')).toMatchObject(invalidGrant('expired refresh token'))
    expect(world.oauth.tokens.get('h(token-3)')?.rotatedAt).toBeUndefined()
    expect(world.assistants.tokens.get('oauth-1')?.revokedAt).toBeUndefined()
  })

  test('the scope granted at consent is kept: a review-only connection stays review-only', async () => {
    const world = setup()
    const decided = await allow(world, { scope: 'review' })
    const code = decided.ok ? codeOf(decided.value.redirectTo) : 'refused'
    expect(await exchange(world, code)).toMatchObject({ ok: true, value: { scope: 'review' } })
    const first = await refresh(world, 'token-3')
    expect(first).toMatchObject({ ok: true, value: { scope: 'review', refresh_token: 'token-5' } })
    expect(await refresh(world, 'token-5')).toMatchObject({ ok: true, value: { scope: 'review' } })
  })

  test('a connection without a client refuses a refresh naming one', async () => {
    const world = setup()
    world.assistants.repository.create({
      id: 'no-client',
      accountId: 'account-1',
      profileId: 'profile-1',
      kind: 'oauth',
      name: 'Legacy',
      createdAt: start,
    })
    world.oauth.repository.createToken({
      tokenHash: 'h(legacy)',
      assistantId: 'no-client',
      kind: 'refresh',
      scope: 'review',
      expiresAt: new Date(start.getTime() + day),
    })
    expect(await refresh(world, 'legacy', 'client-abc')).toMatchObject(
      invalidGrant('the refresh token was issued to another client'),
    )
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
