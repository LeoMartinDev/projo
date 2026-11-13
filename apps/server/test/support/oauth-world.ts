import { appError, err, ok } from '@projo/shared'

import { authenticateOAuthAccessFactory } from '../../src/application/auth/authenticate-oauth-access.ts'
import { decideOAuthConsentFactory } from '../../src/application/auth/decide-oauth-consent.ts'
import { exchangeOAuthTokenFactory } from '../../src/application/auth/exchange-oauth-token.ts'
import { getOAuthConsentFactory } from '../../src/application/auth/get-oauth-consent.ts'
import { purgeExpiredOAuthFactory } from '../../src/application/auth/purge-expired-oauth.ts'
import { registerOAuthClientFactory } from '../../src/application/auth/register-oauth-client.ts'
import type { AssistantAccess } from '../../src/application/auth/shared/assistant-access.ts'
import type { AuthorizationRequest } from '../../src/application/auth/shared/oauth-request.ts'
import type { ClientMetadataFetcher, OAuthClient } from '../../src/core/auth/oauth.ts'
import {
  createFakeSessionTokens,
  createInMemoryAssistantTokens,
  createInMemoryOAuth,
  createInMemoryProfiles,
  sampleProfile,
} from './auth.ts'
import { createManualClock } from './clock.ts'
import { createSequentialIds } from './fakes.ts'
import { createCapturingLogger } from './logger.ts'

export const start = new Date('2026-01-01T00:00:00.000Z')
export const minute = 60_000
export const day = 24 * 60 * minute
export const mcpUrl = 'https://projo.example/mcp'
export const callback = 'https://claude.ai/api/mcp/auth_callback'

export const claude: OAuthClient = {
  id: 'c1',
  clientId: 'client-abc',
  kind: 'dcr',
  name: 'Claude',
  redirectUris: [callback, 'http://127.0.0.1/callback'],
  createdAt: start,
}

export const request = (overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest => ({
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

/** The OAuth use cases on in-memory repositories; `account-1:profile-1` may hold an assistant. */
export const createOAuthWorld = ({
  clients = [claude],
  metadata = async () => err(appError('oauth/invalid_client', 'unreachable')),
}: { clients?: OAuthClient[]; metadata?: ClientMetadataFetcher } = {}) => {
  const oauth = createInMemoryOAuth(clients)
  const assistants = createInMemoryAssistantTokens()
  const allowed = new Set(['account-1:profile-1'])
  const fetched: string[] = []
  const clock = createManualClock(start)
  const { logger, lines } = createCapturingLogger()
  const assistantAccess: AssistantAccess = {
    administers: ({ accountId, profileId }) =>
      allowed.has(`${accountId}:${profileId}`)
        ? ok()
        : err(appError('auth/restricted_profile', 'restricted profile')),
    authenticateAssistant: (found) =>
      found.revokedAt === undefined
        ? ok({ tokenId: found.id, accountId: found.accountId, profileId: found.profileId })
        : err(appError('auth/session_revoked', 'assistant revoked')),
  }
  const deps = {
    oauthRepository: oauth.repository,
    assistantTokenRepository: assistants.repository,
    assistantAccess,
    profileRepository: createInMemoryProfiles([sampleProfile()]).repository,
    clientMetadata: async (url: string) => {
      fetched.push(url)
      return metadata(url)
    },
    pkce: ({ verifier, challenge }: { verifier: string; challenge: string }) =>
      challenge === `S256(${verifier})`,
    tokens: createFakeSessionTokens(),
    clock,
    ids: createSequentialIds('oauth-'),
    logger,
  }
  const service = {
    register: registerOAuthClientFactory(deps),
    consent: getOAuthConsentFactory(deps),
    decide: decideOAuthConsentFactory(deps),
    token: exchangeOAuthTokenFactory(deps),
    authenticateAccess: authenticateOAuthAccessFactory(deps),
    purge: purgeExpiredOAuthFactory(deps),
  }
  return { service, oauth, assistants, allowed, fetched, clock, lines }
}

export type World = ReturnType<typeof createOAuthWorld>

export const allow = (world: World, overrides: Partial<AuthorizationRequest> = {}) =>
  world.service.decide({
    request: request(overrides),
    decision: 'allow',
    mcpUrl,
    accountId: 'account-1',
    profileId: 'profile-1',
  })

export const codeOf = (redirectTo: string): string =>
  new URL(redirectTo).searchParams.get('code') ?? 'no code'

export const authorize = async (world: World): Promise<string> => {
  const decided = await allow(world)
  return decided.ok ? codeOf(decided.value.redirectTo) : 'refused'
}

export const exchange = (
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
export const connect = async (world: World) => exchange(world, await authorize(world))

export const invalidGrant = (message: string) => ({
  ok: false,
  error: { code: 'oauth/invalid_grant', message },
})
