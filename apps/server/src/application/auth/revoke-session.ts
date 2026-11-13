import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = {
  sessionRepository: SessionRepository
  clock: Clock
  logger: Logger
}

export type RevokeSessionError = AppError<'auth/session_not_found'>

export const revokeSessionFactory =
  ({ sessionRepository, clock, logger }: Deps) =>
  ({
    accountId,
    sessionId,
  }: {
    accountId: string
    sessionId: string
  }): Result<void, RevokeSessionError> => {
    const session = sessionRepository.findById(sessionId)
    if (session === undefined || session.accountId !== accountId) {
      return err(
        appError('auth/session_not_found', 'session not found', { context: { sessionId } }),
      )
    }
    if (session.revokedAt === undefined) {
      sessionRepository.revoke({ id: session.id, revokedAt: clock.now() })
      logger.info('session revoked', { sessionId: session.id, accountId })
    }
    return ok()
  }

export type RevokeSession = ReturnType<typeof revokeSessionFactory>
