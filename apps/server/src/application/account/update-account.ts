import type { AppError, Result } from '@projo/shared'
import type { AccountRole } from '@projo/shared/api/auth'

import { removesLastAdmin } from '../../core/account/last-admin.ts'
import type { AccountRepository } from '../../core/auth/account.ts'
import type { SessionRepository } from '../../core/auth/session.ts'
import type { Logger } from '../../core/logger.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { type AccountNotFound, accountNotFound, lastAdmin } from './shared/account-errors.ts'
import {
  type AdminAccountView,
  type AdminAccountViewDeps,
  findAdminAccountView,
} from './shared/admin-account-view.ts'

type Deps = Omit<AdminAccountViewDeps, 'accountRepository'> & {
  accountRepository: Pick<
    AccountRepository,
    'findById' | 'countEnabledAdmins' | 'setRole' | 'setDisabled'
  >
  sessionRepository: Pick<SessionRepository, 'revokeAllByAccount'>
  playbackSessions: PlaybackSessionTerminator
  logger: Logger
}

export type UpdateAccountError = AccountNotFound | AppError<'account/last_admin'>

export const updateAccountFactory =
  (deps: Deps) =>
  ({
    accountId,
    role,
    disabled,
  }: {
    accountId: string
    role?: AccountRole
    disabled?: boolean
  }): Result<AdminAccountView, UpdateAccountError> => {
    const { accountRepository, sessionRepository, playbackSessions, clock, logger } = deps
    const account = accountRepository.findById(accountId)
    if (account === undefined) return accountNotFound(accountId)
    const demotes = role === 'user' && account.role === 'admin'
    const disables = disabled === true && account.disabledAt === undefined
    if (
      (demotes || disables) &&
      removesLastAdmin({ target: account, enabledAdmins: accountRepository.countEnabledAdmins() })
    ) {
      return lastAdmin(accountId)
    }
    if (role !== undefined && role !== account.role) {
      accountRepository.setRole({ id: accountId, role })
    }
    if (disables) {
      accountRepository.setDisabled({ id: accountId, disabledAt: clock.now() })
      sessionRepository.revokeAllByAccount({ accountId, revokedAt: clock.now() })
      playbackSessions.endWithin({ accountId })
      logger.info('account disabled', { accountId })
    }
    if (disabled === false && account.disabledAt !== undefined) {
      accountRepository.setDisabled({ id: accountId, disabledAt: undefined })
      logger.info('account enabled', { accountId })
    }
    return findAdminAccountView(deps, accountId)
  }

export type UpdateAccount = ReturnType<typeof updateAccountFactory>
