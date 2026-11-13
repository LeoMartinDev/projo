import type { AccountRepository } from '../../core/auth/account.ts'
import {
  type AdminAccountView,
  type AdminAccountViewDeps,
  adminAccountViews,
} from './shared/admin-account-view.ts'

type Deps = Omit<AdminAccountViewDeps, 'accountRepository'> & {
  accountRepository: Pick<AccountRepository, 'list'>
}

export const listAccountsFactory = (deps: Deps) => (): AdminAccountView[] =>
  adminAccountViews(deps, deps.accountRepository.list())

export type ListAccounts = ReturnType<typeof listAccountsFactory>
