import { appError, type AppError, err, type Result } from '@projo/shared'

import type { AssistantTokenRepository } from '../../core/auth/assistant-token.ts'
import type { OAuthRepository } from '../../core/auth/oauth.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type {
  AssistantAccess,
  AssistantPrincipal,
  AuthenticateAssistantError,
} from './shared/assistant-access.ts'

type Deps = {
  oauthRepository: Pick<OAuthRepository, 'findToken'>
  assistantTokenRepository: Pick<AssistantTokenRepository, 'findById'>
  assistantAccess: Pick<AssistantAccess, 'authenticateAssistant'>
  tokens: SessionTokens
  clock: Clock
}

export type AuthenticateOAuthAccessError =
  AuthenticateAssistantError | AppError<'auth/session_expired'>

export const authenticateOAuthAccessFactory =
  ({ oauthRepository, assistantTokenRepository, assistantAccess, tokens, clock }: Deps) =>
  (token: string): Result<AssistantPrincipal, AuthenticateOAuthAccessError> => {
    const stored = oauthRepository.findToken(tokens.hash(token))
    if (stored === undefined || stored.kind !== 'access') {
      return err(appError('auth/unauthenticated', 'unknown token'))
    }
    if (stored.expiresAt.getTime() <= clock.now().getTime()) {
      return err(appError('auth/session_expired', 'access token expired'))
    }
    const assistant = assistantTokenRepository.findById(stored.assistantId)
    if (assistant === undefined) return err(appError('auth/unauthenticated', 'unknown token'))
    return assistantAccess.authenticateAssistant(assistant)
  }

export type AuthenticateOAuthAccess = ReturnType<typeof authenticateOAuthAccessFactory>
