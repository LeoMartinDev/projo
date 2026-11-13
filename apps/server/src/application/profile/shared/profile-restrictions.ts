import { appError } from '@projo/shared'
import type { AccountRole } from '@projo/shared/api/auth'

import { removesLastUnrestricted } from '../../../core/account/last-admin.ts'
import type { PasswordHasher } from '../../../core/auth/ports.ts'
import type { Profile, ProfileRepository } from '../../../core/profile/profile.ts'
import type { ProfileRestrictions } from '../../../core/profile/restrictions.ts'

export const restrictionsOf = ({
  libraryAccess,
  libraryIds,
  maxContentRating,
}: ProfileRestrictions): ProfileRestrictions => ({
  libraryAccess,
  libraryIds,
  ...(maxContentRating === undefined ? {} : { maxContentRating }),
})

export const unknownLibraries = (
  profileRepository: Pick<ProfileRepository, 'unknownLibraryIds'>,
  restrictions: ProfileRestrictions,
) => {
  const unknown =
    restrictions.libraryAccess === 'selected'
      ? profileRepository.unknownLibraryIds(restrictions.libraryIds)
      : []
  return unknown.length === 0
    ? undefined
    : appError('profile/unknown_library', 'unknown library', {
        context: { libraryIds: unknown },
      })
}

/** Whether a change would leave an admin account without an unrestricted profile. */
export const locksOutAdmin = (
  {
    profileRepository,
    accountRole,
  }: {
    profileRepository: Pick<ProfileRepository, 'listByAccount'>
    accountRole: (accountId: string) => AccountRole | undefined
  },
  accountId: string,
  after: (profiles: Profile[]) => ProfileRestrictions[],
) => {
  const before = profileRepository.listByAccount(accountId)
  return removesLastUnrestricted({ role: accountRole(accountId), before, after: after(before) })
}

export const hashPin = (passwordHasher: PasswordHasher, pin: string | undefined) =>
  pin === undefined || pin === '' ? Promise.resolve(undefined) : passwordHasher.hash(pin)
