import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  connect,
  createOAuthWorld as setup,
  minute,
  start,
} from '../../../test/support/oauth-world.ts'

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

  test('defensive: a token left without its connection row: auth/unauthenticated', () => {
    const world = setup()
    world.oauth.repository.createToken({
      tokenHash: 'h(orphan)',
      assistantId: 'gone',
      kind: 'access',
      scope: 'review',
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
