import { ok, type Result } from '@projo/shared'

import type { AccountRepository } from '../../core/auth/account.ts'
import type { SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { type AccountNotFound, accountNotFound } from './shared/account-errors.ts'

type Deps = {
  accountRepository: Pick<AccountRepository, 'findById'>
  sessionRepository: Pick<SessionRepository, 'revokeAllByAccount'>
  clock: Clock
  logger: Logger
}

export type RevokeAccountSessionsError = AccountNotFound

export const revokeAccountSessionsFactory =
  ({ accountRepository, sessionRepository, clock, logger }: Deps) =>
  ({ accountId }: { accountId: string }): Result<void, RevokeAccountSessionsError> => {
    if (accountRepository.findById(accountId) === undefined) return accountNotFound(accountId)
    sessionRepository.revokeAllByAccount({ accountId, revokedAt: clock.now() })
    logger.info('sessions revoked by admin', { accountId })
    return ok()
  }

export type RevokeAccountSessions = ReturnType<typeof revokeAccountSessionsFactory>
