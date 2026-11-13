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

export const oauthStart = new Date('2026-01-01T00:00:00.000Z')
export const minuteMs = 60_000
export const dayMs = 24 * 60 * minuteMs
export const mcpUrl = 'https://projo.example/mcp'
export const callback = 'https://claude.ai/api/mcp/auth_callback'

export const claude: OAuthClient = {
  id: 'c1',
  clientId: 'client-abc',
  kind: 'dcr',
  name: 'Claude',
  redirectUris: [callback, 'http://127.0.0.1/callback'],
  createdAt: oauthStart,
}

export const authorizationRequest = (
  overrides: Partial<AuthorizationRequest> = {},
): AuthorizationRequest => ({
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
  const clock = createManualClock(oauthStart)
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
  return {
    registerOAuthClient: registerOAuthClientFactory(deps),
    getOAuthConsent: getOAuthConsentFactory(deps),
    decideOAuthConsent: decideOAuthConsentFactory(deps),
    exchangeOAuthToken: exchangeOAuthTokenFactory(deps),
    authenticateOAuthAccess: authenticateOAuthAccessFactory(deps),
    purgeExpiredOAuth: purgeExpiredOAuthFactory(deps),
    oauth,
    assistants,
    allowed,
    fetched,
    clock,
    lines,
  }
}

export type OAuthWorld = ReturnType<typeof createOAuthWorld>

export const allow = (world: OAuthWorld, overrides: Partial<AuthorizationRequest> = {}) =>
  world.decideOAuthConsent({
    request: authorizationRequest(overrides),
    decision: 'allow',
    mcpUrl,
    accountId: 'account-1',
    profileId: 'profile-1',
  })

export const codeOf = (redirectTo: string): string =>
  new URL(redirectTo).searchParams.get('code') ?? 'no code'

export const authorize = async (world: OAuthWorld): Promise<string> => {
  const decided = await allow(world)
  return decided.ok ? codeOf(decided.value.redirectTo) : 'refused'
}

export const exchange = (
  world: OAuthWorld,
  code: string,
  overrides: Partial<{ codeVerifier: string; redirectUri: string; clientId: string }> = {},
) =>
  world.exchangeOAuthToken({
    grantType: 'authorization_code',
    code,
    codeVerifier: 'verifier',
    redirectUri: callback,
    clientId: 'client-abc',
    ...overrides,
  })

/** Authorizes then exchanges the code: access `token-2`, refresh `token-3`. */
export const connect = async (world: OAuthWorld) => exchange(world, await authorize(world))

export const invalidGrant = (message: string) => ({
  ok: false,
  error: { code: 'oauth/invalid_grant', message },
})
