import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  connect,
  createOAuthWorld as setup,
  minuteMs,
  oauthStart,
} from '../../../test/support/oauth-world.ts'

describe('authenticating an access token', () => {
  test('the assistant principal', async () => {
    const world = setup()
    await connect(world)
    expect(world.authenticateOAuthAccess('token-2')).toEqual(
      ok({ tokenId: 'oauth-1', accountId: 'account-1', profileId: 'profile-1' }),
    )
  })

  test('an unknown token, or a refresh token: auth/unauthenticated', async () => {
    const world = setup()
    await connect(world)
    for (const token of ['forged', 'token-3']) {
      expect(world.authenticateOAuthAccess(token)).toMatchObject({
        ok: false,
        error: { code: 'auth/unauthenticated' },
      })
    }
  })

  test('after an hour: auth/session_expired', async () => {
    const world = setup()
    await connect(world)
    world.clock.advance(60 * minuteMs)
    expect(world.authenticateOAuthAccess('token-2')).toMatchObject({
      ok: false,
      error: { code: 'auth/session_expired' },
    })
  })

  test('defensive: a token left without its connection row: auth/unauthenticated', () => {
    const world = setup()
    world.oauth.repository.createToken({
      tokenHash: 'h(orphan)',
      assistantId: 'gone',
      kind: 'access',
      scope: 'review',
      expiresAt: new Date(oauthStart.getTime() + minuteMs),
    })
    expect(world.authenticateOAuthAccess('orphan')).toMatchObject({
      ok: false,
      error: { code: 'auth/unauthenticated' },
    })
  })

  test('a revoked connection: its own refusal', async () => {
    const world = setup()
    await connect(world)
    world.assistants.repository.revoke({ id: 'oauth-1', revokedAt: oauthStart })
    expect(world.authenticateOAuthAccess('token-2')).toMatchObject({
      ok: false,
      error: { code: 'auth/session_revoked' },
    })
  })
})
