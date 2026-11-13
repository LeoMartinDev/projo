import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { AssistantTokenRepository } from '../../core/auth/assistant-token.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = {
  assistantTokenRepository: Pick<AssistantTokenRepository, 'revoke'>
  clock: Clock
  logger: Logger
}

export type RevokeAssistantTokenError = AppError<'auth/assistant_token_not_found'>

export const revokeAssistantTokenFactory =
  ({ assistantTokenRepository, clock, logger }: Deps) =>
  ({
    id,
    accountId,
  }: {
    id: string
    accountId: string
  }): Result<void, RevokeAssistantTokenError> => {
    if (!assistantTokenRepository.revoke({ id, accountId, revokedAt: clock.now() })) {
      return err(
        appError('auth/assistant_token_not_found', 'assistant token not found', {
          context: { id },
        }),
      )
    }
    logger.info('assistant token revoked', { accountId, assistantTokenId: id })
    return ok()
  }

export type RevokeAssistantToken = ReturnType<typeof revokeAssistantTokenFactory>
