import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { AccountRepository } from '../../core/auth/account.ts'
import { toAuthAccount } from '../../core/auth/account.ts'
import type { AuthAccount } from '../../core/auth/principal.ts'
import type { Profile, ProfileRepository } from '../../core/profile/profile.ts'

type Deps = {
  accountRepository: AccountRepository
  profileRepository: ProfileRepository
}

export type Me = {
  account: AuthAccount
  profiles: Profile[]
  activeProfileId?: string
  /** §13.6 "Who's watching?": no active profile could be resolved for this request. */
  needsProfileSelection: boolean
}

/** `GET /auth/me`: the account and its profiles (§17.2). */
export const getMeFactory =
  ({ accountRepository, profileRepository }: Deps) =>
  ({
    accountId,
    activeProfileId,
  }: {
    accountId: string
    activeProfileId: string | undefined
  }): Result<Me, AppError<'auth/unauthenticated'>> => {
    const account = accountRepository.findById(accountId)
    if (account === undefined) return err(appError('auth/unauthenticated', 'unknown account'))
    const profiles = profileRepository.listByAccount(account.id)
    const active = profiles.find((profile) => profile.id === activeProfileId)?.id
    return ok({
      account: toAuthAccount(account),
      profiles,
      ...(active === undefined ? {} : { activeProfileId: active }),
      needsProfileSelection: active === undefined,
    })
  }

export type GetMe = ReturnType<typeof getMeFactory>
