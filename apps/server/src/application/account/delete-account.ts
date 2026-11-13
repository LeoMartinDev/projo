import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { removesLastAdmin } from '../../core/account/last-admin.ts'
import type { AccountRepository } from '../../core/auth/account.ts'
import type { Logger } from '../../core/logger.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { type AccountNotFound, accountNotFound, lastAdmin } from './shared/account-errors.ts'

type Deps = {
  accountRepository: Pick<AccountRepository, 'findById' | 'countEnabledAdmins' | 'delete'>
  playbackSessions: PlaybackSessionTerminator
  logger: Logger
}

export type DeleteAccountError =
  AccountNotFound | AppError<'account/last_admin' | 'account/confirmation_mismatch'>

export const deleteAccountFactory =
  ({ accountRepository, playbackSessions, logger }: Deps) =>
  ({
    accountId,
    confirmUsername,
  }: {
    accountId: string
    confirmUsername: string
  }): Result<void, DeleteAccountError> => {
    const account = accountRepository.findById(accountId)
    if (account === undefined) return accountNotFound(accountId)
    if (confirmUsername.trim().toLowerCase() !== account.username.toLowerCase()) {
      return err(
        appError('account/confirmation_mismatch', 'typed username does not match', {
          context: { accountId },
        }),
      )
    }
    if (
      removesLastAdmin({ target: account, enabledAdmins: accountRepository.countEnabledAdmins() })
    ) {
      return lastAdmin(accountId)
    }
    playbackSessions.endWithin({ accountId })
    accountRepository.delete(accountId)
    logger.info('account deleted', { accountId })
    return ok()
  }

export type DeleteAccount = ReturnType<typeof deleteAccountFactory>
