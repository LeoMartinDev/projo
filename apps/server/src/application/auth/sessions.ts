import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Session, SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = {
  sessionRepository: SessionRepository
  clock: Clock
  logger: Logger
}

/** The account's devices (§14): active cookie sessions and bearer tokens. */
export const listSessionsFactory =
  ({ sessionRepository, clock }: Omit<Deps, 'logger'>) =>
  ({ accountId }: { accountId: string }): Session[] =>
    sessionRepository.listActiveByAccount({ accountId, now: clock.now() })

export type RevokeSessionError = AppError<'auth/session_not_found'>

/** Revokes one of the account's sessions (logout of a device). Idempotent on revoked sessions. */
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

export type ListSessions = ReturnType<typeof listSessionsFactory>
export type RevokeSession = ReturnType<typeof revokeSessionFactory>
