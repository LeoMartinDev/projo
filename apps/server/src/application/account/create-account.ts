import { appError, type AppError, err, type Result } from '@projo/shared'

import type { AccountRepository } from '../../core/auth/account.ts'
import type { PasswordHasher } from '../../core/auth/ports.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { AccountNotFound } from './shared/account-errors.ts'
import {
  type AdminAccountView,
  type AdminAccountViewDeps,
  findAdminAccountView,
} from './shared/admin-account-view.ts'
import { buildNewAccount, type NewAccountInput } from './shared/new-account.ts'

type Deps = Omit<AdminAccountViewDeps, 'accountRepository'> & {
  accountRepository: Pick<AccountRepository, 'findById' | 'findByUsername' | 'create'>
  passwordHasher: PasswordHasher
  ids: IdGenerator
  logger: Logger
}

export type CreateAccountError = AppError<'auth/username_taken'>

export const createAccountFactory =
  (deps: Deps) =>
  async (
    input: NewAccountInput,
  ): Promise<Result<AdminAccountView, CreateAccountError | AccountNotFound>> => {
    const { accountRepository, logger } = deps
    if (accountRepository.findByUsername(input.username) !== undefined) {
      return err(
        appError('auth/username_taken', 'username already used', {
          context: { username: input.username },
        }),
      )
    }
    const created = await buildNewAccount(deps, input)
    if (accountRepository.create(created) === 'username_taken') {
      return err(
        appError('auth/username_taken', 'username already used', {
          context: { username: input.username },
        }),
      )
    }
    logger.info('account created', { accountId: created.account.id, role: input.role })
    return findAdminAccountView(deps, created.account.id)
  }

export type CreateAccount = ReturnType<typeof createAccountFactory>
