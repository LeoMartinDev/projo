import { appError, err, type Result } from '@projo/shared'

import type { AssistantTokenRepository } from '../../core/auth/assistant-token.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type {
  AssistantAccess,
  AssistantPrincipal,
  AuthenticateAssistantError,
} from './shared/assistant-access.ts'

type Deps = {
  assistantTokenRepository: Pick<AssistantTokenRepository, 'findByTokenHash'>
  assistantAccess: Pick<AssistantAccess, 'authenticateAssistant'>
  tokens: SessionTokens
}

export const authenticateAssistantTokenFactory =
  ({ assistantTokenRepository, assistantAccess, tokens }: Deps) =>
  (token: string): Result<AssistantPrincipal, AuthenticateAssistantError> => {
    const found = assistantTokenRepository.findByTokenHash(tokens.hash(token))
    if (found === undefined || found.kind !== 'token') {
      return err(appError('auth/unauthenticated', 'unknown token'))
    }
    return assistantAccess.authenticateAssistant(found)
  }

export type AuthenticateAssistantToken = ReturnType<typeof authenticateAssistantTokenFactory>
