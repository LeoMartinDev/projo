import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  allow,
  callback,
  createOAuthWorld as setup,
  mcpUrl,
  minute,
  request,
  start,
} from '../../../test/support/oauth-world.ts'

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
    for (const [asked, granted] of [
      ['admin everything', 'review'],
      ['', 'review'],
      ['offline_access', 'review offline_access'],
      ['offline_access admin review', 'review offline_access'],
    ] as const) {
      const world = setup()
      await allow(world, { scope: asked })
      expect([...world.oauth.codes.values()][0]?.scope).toBe(granted)
    }
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
