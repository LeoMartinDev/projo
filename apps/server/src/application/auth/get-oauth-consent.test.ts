import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  callback,
  createOAuthWorld as setup,
  day,
  mcpUrl,
  request,
  start,
  type World,
} from '../../../test/support/oauth-world.ts'
import type { ClientMetadataFetcher } from '../../core/auth/oauth.ts'
import type { AuthorizationRequest } from './shared/oauth-request.ts'

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
