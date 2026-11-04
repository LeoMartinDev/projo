import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { AssistantTokenRepository } from '../../core/auth/assistant-token.ts'
import {
  type ClientMetadataFetcher,
  grantedScope,
  isAcceptableRedirectUri,
  isLoopbackRedirectUri,
  type OAuthClient,
  oauthLifetimes,
  type OAuthRepository,
  type PkceVerifier,
  redirectUriMatches,
  redirectWith,
  resourceMatches,
} from '../../core/auth/oauth.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { ProfileRepository } from '../../core/profile/profile.ts'
import type {
  AssistantPrincipal,
  AssistantTokens,
  AuthenticateAssistantError,
} from './assistant-tokens.ts'

type Deps = {
  oauthRepository: OAuthRepository
  assistantTokenRepository: AssistantTokenRepository
  assistantTokens: Pick<AssistantTokens, 'administers' | 'authenticateAssistant'>
  profileRepository: Pick<ProfileRepository, 'findById'>
  clientMetadata: ClientMetadataFetcher
  pkce: PkceVerifier
  tokens: SessionTokens
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type AuthorizationRequest = {
  responseType: string
  clientId: string
  redirectUri: string
  state?: string
  codeChallenge: string
  codeChallengeMethod: string
  scope?: string
  resource?: string
}

export type ConsentError = AppError<
  'oauth/invalid_client' | 'oauth/invalid_redirect_uri' | 'oauth/invalid_request'
>

export type TokenRequest =
  | {
      grantType: 'authorization_code'
      code: string
      codeVerifier: string
      redirectUri: string
      clientId: string
    }
  | { grantType: 'refresh_token'; refreshToken: string; clientId?: string }

export type TokenResponse = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

export type TokenError = AppError<'oauth/invalid_grant' | 'oauth/invalid_client'>

const invalidGrant = (message: string) => err(appError('oauth/invalid_grant', message))

export const oauthFactory = ({
  oauthRepository,
  assistantTokenRepository,
  assistantTokens,
  profileRepository,
  clientMetadata,
  pkce,
  tokens,
  clock,
  ids,
  logger,
}: Deps) => {
  const resolveClient = async (
    clientId: string,
  ): Promise<Result<OAuthClient, AppError<'oauth/invalid_client'>>> => {
    const known = oauthRepository.findClient(clientId)
    const now = clock.now()
    if (!/^https?:\/\//.test(clientId)) {
      return known === undefined
        ? err(appError('oauth/invalid_client', 'unknown client', { context: { clientId } }))
        : ok(known)
    }
    if (
      known?.fetchedAt !== undefined &&
      now.getTime() - known.fetchedAt.getTime() < oauthLifetimes.clientMetadataMs
    ) {
      return ok(known)
    }
    const document = await clientMetadata(clientId)
    if (!document.ok) return document
    const redirectUris = document.value.redirectUris.filter(isAcceptableRedirectUri)
    return ok(
      oauthRepository.saveClient({
        id: known?.id ?? ids.next(),
        clientId,
        kind: 'cimd',
        name: document.value.name ?? new URL(clientId).hostname,
        redirectUris,
        createdAt: known?.createdAt ?? now,
        fetchedAt: now,
        ...(known?.lastUsedAt === undefined ? {} : { lastUsedAt: known.lastUsedAt }),
      }),
    )
  }

  const checkRequest = async (
    request: AuthorizationRequest,
    mcpUrl: string,
  ): Promise<Result<{ client: OAuthClient; scope: string }, ConsentError>> => {
    const client = await resolveClient(request.clientId)
    if (!client.ok) return client
    if (!client.value.redirectUris.some((uri) => redirectUriMatches(uri, request.redirectUri))) {
      return err(
        appError('oauth/invalid_redirect_uri', 'redirect_uri is not one of the client', {
          context: { clientId: request.clientId },
        }),
      )
    }
    const invalid = (reason: string) =>
      err(appError('oauth/invalid_request', reason, { context: { reason } }))
    if (request.responseType !== 'code') return invalid('response_type must be code')
    if (request.codeChallengeMethod !== 'S256') return invalid('PKCE S256 is required')
    if (!resourceMatches(request.resource, mcpUrl)) return invalid('unknown resource')
    return ok({ client: client.value, scope: grantedScope(request.scope) })
  }

  const issueTokens = (assistantId: string, scope: string): TokenResponse => {
    const now = clock.now().getTime()
    const access = tokens.generate()
    const refresh = tokens.generate()
    oauthRepository.createToken({
      tokenHash: tokens.hash(access),
      assistantId,
      kind: 'access',
      expiresAt: new Date(now + oauthLifetimes.accessTokenMs),
    })
    oauthRepository.createToken({
      tokenHash: tokens.hash(refresh),
      assistantId,
      kind: 'refresh',
      expiresAt: new Date(now + oauthLifetimes.refreshTokenMs),
    })
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.round(oauthLifetimes.accessTokenMs / 1000),
      refresh_token: refresh,
      scope,
    }
  }

  return {
    register: ({
      clientName,
      redirectUris,
    }: {
      clientName?: string
      redirectUris: string[]
    }): Result<OAuthClient, AppError<'oauth/invalid_redirect_uri' | 'oauth/invalid_request'>> => {
      if (redirectUris.length === 0) {
        return err(appError('oauth/invalid_request', 'redirect_uris is required'))
      }
      const refused = redirectUris.find((uri) => !isAcceptableRedirectUri(uri))
      if (refused !== undefined) {
        return err(
          appError('oauth/invalid_redirect_uri', 'redirect URIs must be HTTPS or loopback', {
            context: { redirectUri: refused },
          }),
        )
      }
      const client = oauthRepository.saveClient({
        id: ids.next(),
        clientId: tokens.generate(),
        kind: 'dcr',
        name: clientName?.trim() || 'MCP client',
        redirectUris,
        createdAt: clock.now(),
      })
      logger.info('oauth client registered', { oauthClientId: client.id, name: client.name })
      return ok(client)
    },

    consent: async ({
      request,
      mcpUrl,
      accountId,
      profileId,
    }: {
      request: AuthorizationRequest
      mcpUrl: string
      accountId: string
      profileId: string | undefined
    }): Promise<
      Result<
        {
          client: { name: string; redirectHost: string; loopback: boolean }
          canAuthorize: boolean
          profile?: { id: string; name: string }
        },
        ConsentError
      >
    > => {
      const checked = await checkRequest(request, mcpUrl)
      if (!checked.ok) return checked
      const profile = profileId === undefined ? undefined : profileRepository.findById(profileId)
      const canAuthorize =
        profile !== undefined &&
        assistantTokens.administers({ accountId, profileId: profile.id }).ok
      return ok({
        client: {
          name: checked.value.client.name,
          redirectHost: new URL(request.redirectUri).host,
          loopback: isLoopbackRedirectUri(request.redirectUri),
        },
        canAuthorize,
        ...(profile === undefined ? {} : { profile: { id: profile.id, name: profile.name } }),
      })
    },

    decide: async ({
      request,
      decision,
      mcpUrl,
      accountId,
      profileId,
    }: {
      request: AuthorizationRequest
      decision: 'allow' | 'deny'
      mcpUrl: string
      accountId: string
      profileId: string | undefined
    }): Promise<Result<{ redirectTo: string }, ConsentError | AppError<'oauth/access_denied'>>> => {
      const checked = await checkRequest(request, mcpUrl)
      if (!checked.ok) return checked
      if (decision === 'deny') {
        return ok({
          redirectTo: redirectWith(request.redirectUri, {
            error: 'access_denied',
            state: request.state,
          }),
        })
      }
      if (profileId === undefined || !assistantTokens.administers({ accountId, profileId }).ok) {
        return err(
          appError('oauth/access_denied', 'only an admin on an unrestricted profile may allow'),
        )
      }
      const code = tokens.generate()
      oauthRepository.createCode({
        codeHash: tokens.hash(code),
        clientId: checked.value.client.id,
        accountId,
        profileId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        scope: checked.value.scope,
        expiresAt: new Date(clock.now().getTime() + oauthLifetimes.codeMs),
      })
      logger.info('oauth authorization granted', {
        accountId,
        oauthClientId: checked.value.client.id,
      })
      return ok({ redirectTo: redirectWith(request.redirectUri, { code, state: request.state }) })
    },

    token: async (request: TokenRequest): Promise<Result<TokenResponse, TokenError>> => {
      const now = clock.now()
      if (request.grantType === 'authorization_code') {
        const code = oauthRepository.consumeCode({
          codeHash: tokens.hash(request.code),
          usedAt: now,
        })
        if (code === undefined) return invalidGrant('unknown or used code')
        if (code.expiresAt.getTime() <= now.getTime()) return invalidGrant('expired code')
        const client = oauthRepository.findClientById(code.clientId)
        if (client === undefined || client.clientId !== request.clientId) {
          return invalidGrant('the code was issued to another client')
        }
        if (code.redirectUri !== request.redirectUri) return invalidGrant('redirect_uri mismatch')
        if (!pkce({ verifier: request.codeVerifier, challenge: code.codeChallenge })) {
          return invalidGrant('PKCE verification failed')
        }
        if (!assistantTokens.administers(code).ok) return invalidGrant('access no longer allowed')
        const assistant = assistantTokenRepository.create({
          id: ids.next(),
          accountId: code.accountId,
          profileId: code.profileId,
          kind: 'oauth',
          clientId: client.id,
          name: client.name,
          createdAt: now,
        })
        oauthRepository.touchClient({ id: client.id, at: now })
        logger.info('oauth assistant connected', {
          accountId: code.accountId,
          assistantTokenId: assistant.id,
          oauthClientId: client.id,
        })
        return ok(issueTokens(assistant.id, code.scope))
      }

      const tokenHash = tokens.hash(request.refreshToken)
      const stored = oauthRepository.findToken(tokenHash)
      if (stored === undefined || stored.kind !== 'refresh') {
        return invalidGrant('unknown refresh token')
      }
      const assistant = assistantTokenRepository.findById(stored.assistantId)
      if (assistant === undefined || assistant.revokedAt !== undefined) {
        return invalidGrant('assistant revoked')
      }
      if (stored.rotatedAt !== undefined || !oauthRepository.markRotated({ tokenHash, at: now })) {
        assistantTokenRepository.revoke({ id: assistant.id, revokedAt: now })
        logger.warn('oauth refresh token reused, assistant revoked', {
          assistantTokenId: assistant.id,
        })
        return invalidGrant('refresh token already used')
      }
      if (stored.expiresAt.getTime() <= now.getTime()) return invalidGrant('expired refresh token')
      const client =
        assistant.clientId === undefined
          ? undefined
          : oauthRepository.findClientById(assistant.clientId)
      if (request.clientId !== undefined && client?.clientId !== request.clientId) {
        return invalidGrant('the refresh token was issued to another client')
      }
      if (!assistantTokens.administers(assistant).ok)
        return invalidGrant('access no longer allowed')
      if (client !== undefined) oauthRepository.touchClient({ id: client.id, at: now })
      return ok(issueTokens(assistant.id, grantedScope('review offline_access')))
    },

    authenticateAccess: (
      token: string,
    ): Result<
      AssistantPrincipal,
      AuthenticateAssistantError | AppError<'auth/session_expired'>
    > => {
      const stored = oauthRepository.findToken(tokens.hash(token))
      if (stored === undefined || stored.kind !== 'access') {
        return err(appError('auth/unauthenticated', 'unknown token'))
      }
      if (stored.expiresAt.getTime() <= clock.now().getTime()) {
        return err(appError('auth/session_expired', 'access token expired'))
      }
      const assistant = assistantTokenRepository.findById(stored.assistantId)
      if (assistant === undefined) return err(appError('auth/unauthenticated', 'unknown token'))
      return assistantTokens.authenticateAssistant(assistant)
    },

    purge: () => {
      const now = clock.now()
      oauthRepository.purge({
        now,
        unusedBefore: new Date(now.getTime() - oauthLifetimes.unusedRegistrationMs),
      })
    },
  }
}

export type OAuth = ReturnType<typeof oauthFactory>
