import { ok, type Result } from '@projo/shared'

import type { AccountRepository } from '../../core/auth/account.ts'
import type { PasswordHasher } from '../../core/auth/ports.ts'
import type { SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { type AccountNotFound, accountNotFound } from './shared/account-errors.ts'

type Deps = {
  accountRepository: Pick<AccountRepository, 'findById' | 'setPasswordHash'>
  sessionRepository: Pick<SessionRepository, 'revokeAllByAccount'>
  passwordHasher: PasswordHasher
  clock: Clock
  logger: Logger
}

export type ResetAccountPasswordError = AccountNotFound

export const resetAccountPasswordFactory =
  ({ accountRepository, sessionRepository, passwordHasher, clock, logger }: Deps) =>
  async ({
    accountId,
    password,
  }: {
    accountId: string
    password: string
  }): Promise<Result<void, ResetAccountPasswordError>> => {
    if (accountRepository.findById(accountId) === undefined) return accountNotFound(accountId)
    accountRepository.setPasswordHash({
      id: accountId,
      passwordHash: await passwordHasher.hash(password),
    })
    sessionRepository.revokeAllByAccount({ accountId, revokedAt: clock.now() })
    logger.info('password reset by admin', { accountId })
    return ok()
  }

export type ResetAccountPassword = ReturnType<typeof resetAccountPasswordFactory>
