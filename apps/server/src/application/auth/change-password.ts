import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { AccountRepository } from '../../core/auth/account.ts'
import type { PasswordHasher, RateLimiter } from '../../core/auth/ports.ts'
import type { SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = {
  accountRepository: AccountRepository
  sessionRepository: SessionRepository
  passwordHasher: PasswordHasher
  /** Same budget as login (§20), keyed by account. */
  rateLimiter: RateLimiter
  clock: Clock
  logger: Logger
}

export type ChangePasswordError = AppError<
  'auth/unauthenticated' | 'auth/rate_limited' | 'account/wrong_password'
>

/** `POST /auth/password`: proves the current password, then revokes every other session (§14). */
export const changePasswordFactory =
  ({ accountRepository, sessionRepository, passwordHasher, rateLimiter, clock, logger }: Deps) =>
  async ({
    accountId,
    sessionId,
    currentPassword,
    newPassword,
  }: {
    accountId: string
    sessionId: string
    currentPassword: string
    newPassword: string
  }): Promise<Result<void, ChangePasswordError>> => {
    const key = `password:account:${accountId}`
    const retryAfterMs = rateLimiter.blockedFor(key)
    if (retryAfterMs !== undefined) {
      return err(
        appError('auth/rate_limited', 'too many password attempts', {
          context: { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) },
        }),
      )
    }
    rateLimiter.hit(key)
    const account = accountRepository.findById(accountId)
    if (account === undefined) return err(appError('auth/unauthenticated', 'unknown account'))
    if (!(await passwordHasher.verify(currentPassword, account.passwordHash))) {
      return err(appError('account/wrong_password', 'current password does not match'))
    }
    rateLimiter.reset(key)
    accountRepository.setPasswordHash({
      id: account.id,
      passwordHash: await passwordHasher.hash(newPassword),
    })
    sessionRepository.revokeAllByAccount({
      accountId: account.id,
      revokedAt: clock.now(),
      exceptId: sessionId,
    })
    logger.info('password changed', { accountId: account.id })
    return ok()
  }

export type ChangePassword = ReturnType<typeof changePasswordFactory>
