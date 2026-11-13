import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import { callback, createOAuthWorld as setup, start } from '../../../test/support/oauth-world.ts'

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
