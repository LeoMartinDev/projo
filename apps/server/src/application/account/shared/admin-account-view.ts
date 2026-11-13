import { ok, type Result } from '@projo/shared'

import type { AccountActivity, AccountActivityQuery } from '../../../core/account/activity.ts'
import type { Account, AccountRepository } from '../../../core/auth/account.ts'
import type { Clock } from '../../../core/clock.ts'
import type { Profile, ProfileRepository } from '../../../core/profile/profile.ts'
import { type AccountNotFound, accountNotFound } from './account-errors.ts'

export type AdminAccountView = {
  account: Account
  profiles: Profile[]
  activity: AccountActivity
}

export type AdminAccountViewDeps = {
  accountRepository: Pick<AccountRepository, 'findById'>
  profileRepository: Pick<ProfileRepository, 'listByAccount'>
  accountActivity: AccountActivityQuery
  clock: Clock
}

export const adminAccountViews = (
  { profileRepository, accountActivity, clock }: Omit<AdminAccountViewDeps, 'accountRepository'>,
  accounts: Account[],
): AdminAccountView[] => {
  const activity = accountActivity({ now: clock.now() })
  return accounts.map((account) => ({
    account,
    profiles: profileRepository.listByAccount(account.id),
    activity: activity.get(account.id) ?? {
      accountId: account.id,
      activeSessions: 0,
      playingProfileIds: [],
    },
  }))
}

export const findAdminAccountView = (
  deps: AdminAccountViewDeps,
  accountId: string,
): Result<AdminAccountView, AccountNotFound> => {
  const account = deps.accountRepository.findById(accountId)
  if (account === undefined) return accountNotFound(accountId)
  const [view] = adminAccountViews(deps, [account])
  return view === undefined ? accountNotFound(accountId) : ok(view)
}
