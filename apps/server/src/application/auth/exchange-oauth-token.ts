import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { AssistantTokenRepository } from '../../core/auth/assistant-token.ts'
import { oauthLifetimes, type OAuthRepository, type PkceVerifier } from '../../core/auth/oauth.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { AssistantAccess } from './shared/assistant-access.ts'

type Deps = {
  oauthRepository: OAuthRepository
  assistantTokenRepository: Pick<AssistantTokenRepository, 'create' | 'findById' | 'revoke'>
  assistantAccess: Pick<AssistantAccess, 'administers'>
  pkce: PkceVerifier
  tokens: SessionTokens
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

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

export type TokenError = AppError<'oauth/invalid_grant'>

const invalidGrant = (message: string) => err(appError('oauth/invalid_grant', message))

export const exchangeOAuthTokenFactory = ({
  oauthRepository,
  assistantTokenRepository,
  assistantAccess,
  pkce,
  tokens,
  clock,
  ids,
  logger,
}: Deps) => {
  const issueTokens = (assistantId: string, scope: string): TokenResponse => {
    const now = clock.now().getTime()
    const access = tokens.generate()
    const refresh = tokens.generate()
    oauthRepository.createToken({
      tokenHash: tokens.hash(access),
      assistantId,
      kind: 'access',
      scope,
      expiresAt: new Date(now + oauthLifetimes.accessTokenMs),
    })
    oauthRepository.createToken({
      tokenHash: tokens.hash(refresh),
      assistantId,
      kind: 'refresh',
      scope,
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

  return async (request: TokenRequest): Promise<Result<TokenResponse, TokenError>> => {
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
      if (!assistantAccess.administers(code).ok) return invalidGrant('access no longer allowed')
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
    const reused = () => {
      assistantTokenRepository.revoke({ id: assistant.id, revokedAt: now })
      logger.warn('oauth refresh token reused, assistant revoked', {
        assistantTokenId: assistant.id,
      })
      return invalidGrant('refresh token already used')
    }
    if (stored.rotatedAt !== undefined) return reused()
    if (stored.expiresAt.getTime() <= now.getTime()) return invalidGrant('expired refresh token')
    if (!oauthRepository.markRotated({ tokenHash, at: now })) return reused()
    const client =
      assistant.clientId === undefined
        ? undefined
        : oauthRepository.findClientById(assistant.clientId)
    if (request.clientId !== undefined && client?.clientId !== request.clientId) {
      return invalidGrant('the refresh token was issued to another client')
    }
    if (!assistantAccess.administers(assistant).ok) return invalidGrant('access no longer allowed')
    if (client !== undefined) oauthRepository.touchClient({ id: client.id, at: now })
    return ok(issueTokens(assistant.id, stored.scope))
  }
}

export type ExchangeOAuthToken = ReturnType<typeof exchangeOAuthTokenFactory>
