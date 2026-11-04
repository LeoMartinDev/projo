import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { Hono } from 'hono'

import type { AuthorizationRequest } from '../../src/application/auth/oauth.ts'
import type { AppEnv } from '../../src/entrypoints/http/context.ts'
import { buildAssistantsModule } from '../../src/entrypoints/modules/assistants.ts'
import { createClientMetadataFetcher } from '../../src/infrastructure/oauth/client-metadata-fetcher.ts'
import { insertProfile, seedViewer } from '../support/catalog-fixtures.ts'
import { silentLogger } from '../support/logger.ts'
import { createMetadataWorld, type MetadataWorld } from '../support/metadata-world.ts'

setDefaultTimeout(30_000)

const origin = 'http://localhost'
const mcpUrl = `${origin}/mcp`
const verifier = 'v'.repeat(20) + '-._~' + 'A1'.repeat(12)
const challenge = Buffer.from(new Bun.CryptoHasher('sha256').update(verifier).digest()).toString(
  'base64url',
)

let world: MetadataWorld
let assistants: ReturnType<typeof buildAssistantsModule>
let app: Hono<AppEnv>
let viewer: ReturnType<typeof seedViewer>
let documents: ReturnType<typeof Bun.serve>
let documentBody: (url: string) => unknown

beforeEach(() => {
  world = createMetadataWorld()
  documents = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => Response.json(documentBody(request.url)),
  })
  documentBody = (url) => ({
    client_id: url,
    client_name: 'Claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback'],
  })
  assistants = buildAssistantsModule(world.platform, {
    assistantPorts: world.metadata.assistantPorts,
    clientMetadata: createClientMetadataFetcher({ allowPrivateAddresses: true }),
  })
  viewer = seedViewer(world.db, 'admin-1')
  app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('logger', silentLogger)
      await next()
    })
    .route('/', assistants.mcpRoutes)
    .route('/', assistants.oauthRoutes)
})
afterEach(async () => {
  void documents.stop(true)
  await world.stop()
})

const register = async (
  redirectUris = ['https://chatgpt.com/connector_platform_oauth_redirect'],
) => {
  const response = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: redirectUris }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { client_id: string; redirect_uris: string[] }
}

const requestFor = (
  clientId: string,
  redirectUri: string,
  overrides: Partial<AuthorizationRequest> = {},
): AuthorizationRequest => ({
  responseType: 'code',
  clientId,
  redirectUri,
  state: 'xyz',
  codeChallenge: challenge,
  codeChallengeMethod: 'S256',
  scope: 'review offline_access',
  resource: mcpUrl,
  ...overrides,
})

const allow = async (request: AuthorizationRequest) => {
  const decided = await assistants.oauth.decide({
    request,
    decision: 'allow',
    mcpUrl,
    accountId: viewer.accountId,
    profileId: viewer.profileId,
  })
  if (!decided.ok) throw new Error(decided.error.code)
  const redirect = new URL(decided.value.redirectTo)
  expect(redirect.searchParams.get('state')).toBe('xyz')
  return redirect.searchParams.get('code') ?? ''
}

const token = (form: Record<string, string>) =>
  app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })

const ping = (accessToken: string) =>
  app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })

type Tokens = { access_token: string; refresh_token: string; expires_in: number; scope: string }

describe('OAuth 2.1 of the MCP server (§27.3)', () => {
  test('discovery documents, and nothing from the SPA', async () => {
    const resource = await app.request('/.well-known/oauth-protected-resource')
    expect(await resource.json()).toMatchObject({
      resource: mcpUrl,
      authorization_servers: [origin],
      scopes_supported: ['review', 'offline_access'],
    })
    expect((await app.request('/.well-known/oauth-protected-resource/mcp')).status).toBe(200)
    const server = await app.request('/.well-known/oauth-authorization-server')
    expect(await server.json()).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
    })
  })

  test('registration, consent, code, tokens, /mcp, refresh rotation and reuse detection', async () => {
    const client = await register()
    const redirectUri = client.redirect_uris[0] ?? ''
    const consent = await assistants.oauth.consent({
      request: requestFor(client.client_id, redirectUri),
      mcpUrl,
      accountId: viewer.accountId,
      profileId: viewer.profileId,
    })
    expect(consent).toMatchObject({
      ok: true,
      value: {
        client: { name: 'ChatGPT', redirectHost: 'chatgpt.com', loopback: false },
        canAuthorize: true,
        profile: { id: viewer.profileId },
      },
    })

    const code = await allow(requestFor(client.client_id, redirectUri))
    const wrongVerifier = await token({
      grant_type: 'authorization_code',
      code,
      code_verifier: 'w'.repeat(43),
      redirect_uri: redirectUri,
      client_id: client.client_id,
    })
    expect(wrongVerifier.status).toBe(400)
    expect(await wrongVerifier.json()).toMatchObject({ error: 'invalid_grant' })
    const reused = await token({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: client.client_id,
    })
    expect(reused.status).toBe(400)

    const fresh = await allow(requestFor(client.client_id, redirectUri))
    const exchanged = await token({
      grant_type: 'authorization_code',
      code: fresh,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: client.client_id,
    })
    expect(exchanged.status).toBe(200)
    expect(exchanged.headers.get('cache-control')).toBe('no-store')
    const first = (await exchanged.json()) as Tokens
    expect(first).toMatchObject({ expires_in: 3600, scope: 'review offline_access' })
    expect((await ping(first.access_token)).status).toBe(200)
    expect(assistants.assistantTokens.list({ accountId: viewer.accountId })).toMatchObject([
      { kind: 'oauth', name: 'ChatGPT' },
    ])

    const refreshed = await token({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
    })
    expect(refreshed.status).toBe(200)
    const second = (await refreshed.json()) as Tokens
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect((await ping(second.access_token)).status).toBe(200)

    const replayed = await token({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
    })
    expect(await replayed.json()).toMatchObject({ error: 'invalid_grant' })
    expect((await ping(second.access_token)).status).toBe(401)
    expect(assistants.assistantTokens.list({ accountId: viewer.accountId })).toEqual([])
  })

  test('an access token expires after an hour; the admin revokes a connection', async () => {
    const client = await register()
    const redirectUri = client.redirect_uris[0] ?? ''
    const code = await allow(requestFor(client.client_id, redirectUri))
    const tokens = (await (
      await token({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: client.client_id,
      })
    ).json()) as Tokens
    world.clock.advance(3_600_001)
    const expired = await ping(tokens.access_token)
    expect(expired.status).toBe(401)
    expect(expired.headers.get('www-authenticate')).toContain('resource_metadata=')

    const refreshed = (await (
      await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
    ).json()) as Tokens
    expect((await ping(refreshed.access_token)).status).toBe(200)
    const [assistant] = assistants.assistantTokens.list({ accountId: viewer.accountId })
    assistants.assistantTokens.revoke({ id: assistant?.id ?? '', accountId: viewer.accountId })
    expect((await ping(refreshed.access_token)).status).toBe(401)
    const afterRevoke = await token({
      grant_type: 'refresh_token',
      refresh_token: refreshed.refresh_token,
    })
    expect(await afterRevoke.json()).toMatchObject({ error: 'invalid_grant' })
  })

  test('consent refuses unknown clients, foreign redirects, plain PKCE, another resource', async () => {
    const client = await register()
    const redirectUri = client.redirect_uris[0] ?? ''
    const consent = (request: AuthorizationRequest) =>
      assistants.oauth.consent({
        request,
        mcpUrl,
        accountId: viewer.accountId,
        profileId: viewer.profileId,
      })
    expect(await consent(requestFor('nope', redirectUri))).toMatchObject({
      ok: false,
      error: { code: 'oauth/invalid_client' },
    })
    expect(await consent(requestFor(client.client_id, 'https://evil.example/cb'))).toMatchObject({
      ok: false,
      error: { code: 'oauth/invalid_redirect_uri' },
    })
    expect(
      await consent(requestFor(client.client_id, redirectUri, { codeChallengeMethod: 'plain' })),
    ).toMatchObject({ ok: false, error: { code: 'oauth/invalid_request' } })
    expect(
      await consent(requestFor(client.client_id, redirectUri, { resource: 'https://other/mcp' })),
    ).toMatchObject({ ok: false, error: { code: 'oauth/invalid_request' } })

    const denied = await assistants.oauth.decide({
      request: requestFor(client.client_id, redirectUri),
      decision: 'deny',
      mcpUrl,
      accountId: viewer.accountId,
      profileId: viewer.profileId,
    })
    expect(denied.ok && new URL(denied.value.redirectTo).searchParams.get('error')).toBe(
      'access_denied',
    )
    const registered = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
    })
    expect(await registered.json()).toMatchObject({ error: 'invalid_redirect_uri' })
  })

  test('a restricted profile or a non-admin cannot allow', async () => {
    const client = await register()
    const redirectUri = client.redirect_uris[0] ?? ''
    const kid = insertProfile(world.db, viewer.accountId, 'kid')
    world.db.$client.query("UPDATE profiles SET max_content_rating = '10' WHERE id = 'kid'").run()
    const asKid = await assistants.oauth.consent({
      request: requestFor(client.client_id, redirectUri),
      mcpUrl,
      accountId: viewer.accountId,
      profileId: kid,
    })
    expect(asKid).toMatchObject({ ok: true, value: { canAuthorize: false } })
    const allowed = await assistants.oauth.decide({
      request: requestFor(client.client_id, redirectUri),
      decision: 'allow',
      mcpUrl,
      accountId: viewer.accountId,
      profileId: kid,
    })
    expect(allowed).toMatchObject({ ok: false, error: { code: 'oauth/access_denied' } })
  })

  test('a Client ID Metadata Document: read, its loopback redirect matched without the port', async () => {
    const clientId = `http://127.0.0.1:${documents.port}/claude-code.json`
    const loopback = 'http://localhost:53682/callback'
    const consent = await assistants.oauth.consent({
      request: requestFor(clientId, loopback),
      mcpUrl,
      accountId: viewer.accountId,
      profileId: viewer.profileId,
    })
    expect(consent).toMatchObject({
      ok: true,
      value: { client: { name: 'Claude', loopback: true, redirectHost: 'localhost:53682' } },
    })
    const code = await allow(requestFor(clientId, loopback))
    const exchanged = await token({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: loopback,
      client_id: clientId,
    })
    expect(exchanged.status).toBe(200)

    documentBody = () => ({ client_id: 'https://someone.else/doc.json', redirect_uris: [] })
    const mismatched = await assistants.oauth.consent({
      request: requestFor(`http://127.0.0.1:${documents.port}/other.json`, loopback),
      mcpUrl,
      accountId: viewer.accountId,
      profileId: viewer.profileId,
    })
    expect(mismatched).toMatchObject({ ok: false, error: { code: 'oauth/invalid_client' } })
  })

  test('the real fetcher refuses plain HTTP and private addresses', async () => {
    const fetcher = createClientMetadataFetcher()
    expect(await fetcher(`http://127.0.0.1:${documents.port}/x.json`)).toMatchObject({
      ok: false,
      error: { context: { reason: 'not HTTPS' } },
    })
    expect(await fetcher('https://127.0.0.1/x.json')).toMatchObject({
      ok: false,
      error: { context: { reason: 'private address' } },
    })
  })
})
