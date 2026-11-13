import { appError, type AppError, err, type Result } from '@projo/shared'
import type { AccountRole } from '@projo/shared/api/auth'

import type { Profile } from '../../core/profile/profile.ts'
import { unrestricted } from '../../core/profile/restrictions.ts'
import {
  type CreateProfileError,
  type CreateProfileInput,
  createProfileInAccount,
  type ProfileCreationDeps,
} from './shared/profile-creation.ts'

type Deps = ProfileCreationDeps & {
  accountRole: (accountId: string) => AccountRole | undefined
}

export type CreateAccountProfileError = CreateProfileError | AppError<'account/not_found'>

/** An admin adds a profile to any account, without restriction ceiling. */
export const createAccountProfileFactory =
  (deps: Deps) =>
  ({
    accountId,
    input,
  }: {
    accountId: string
    input: CreateProfileInput
  }): Promise<Result<Profile, CreateAccountProfileError>> =>
    deps.accountRole(accountId) === undefined
      ? Promise.resolve(
          err(appError('account/not_found', 'account not found', { context: { accountId } })),
        )
      : createProfileInAccount(deps, { accountId, ceiling: unrestricted, input })

export type CreateAccountProfile = ReturnType<typeof createAccountProfileFactory>
