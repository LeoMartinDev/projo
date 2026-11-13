import { appError, type AppError, err } from '@projo/shared'

import type { AccountRepository } from '../../../core/auth/account.ts'
import type { Profile, ProfileRepository } from '../../../core/profile/profile.ts'

export type LibraryProfileAccess = {
  profile: Profile
  username: string
  hasAccess: boolean
}

export type LibraryAccessError = AppError<
  'library/not_found' | 'profile/not_found' | 'profile/last_unrestricted'
>

export type LibraryProfileAccessDeps = {
  profileRepository: Pick<ProfileRepository, 'listByAccount'>
  accountRepository: Pick<AccountRepository, 'list'>
}

export const sees = (profile: Profile, libraryId: string): boolean =>
  profile.libraryAccess === 'all' || profile.libraryIds.includes(libraryId)

/** Every profile of every account, with its account's username. */
export const everyProfile = ({
  profileRepository,
  accountRepository,
}: LibraryProfileAccessDeps): { profile: Profile; username: string }[] =>
  accountRepository
    .list()
    .flatMap((account) =>
      profileRepository
        .listByAccount(account.id)
        .map((profile) => ({ profile, username: account.username })),
    )

export const libraryProfileAccess = (
  deps: LibraryProfileAccessDeps,
  libraryId: string,
): LibraryProfileAccess[] =>
  everyProfile(deps).map(({ profile, username }) => ({
    profile,
    username,
    hasAccess: sees(profile, libraryId),
  }))

export const libraryNotFound = (libraryId: string) =>
  err(appError('library/not_found', 'library not found', { context: { id: libraryId } }))
