import { appError, type AppError, err } from '@projo/shared'

import type { Profile, ProfileRepository } from '../../../core/profile/profile.ts'
import {
  effectiveRestrictions,
  isRestricted,
  type ProfileRestrictions,
} from '../../../core/profile/restrictions.ts'

export type AccountActionError = AppError<'profile/restricted'>

export type ActingProfile = {
  active: Profile | undefined
  effective: ProfileRestrictions
  restricted: boolean
}

/** The profile an account acts from, and the restrictions that bound what it may do. */
export const actingProfile = (
  profileRepository: Pick<ProfileRepository, 'findById' | 'listByAccount'>,
  {
    accountId,
    activeProfileId,
  }: {
    accountId: string
    activeProfileId: string | undefined
  },
): ActingProfile => {
  const found =
    activeProfileId === undefined ? undefined : profileRepository.findById(activeProfileId)
  const active = found?.accountId === accountId ? found : undefined
  const effective = effectiveRestrictions({
    active,
    accountProfiles: active === undefined ? profileRepository.listByAccount(accountId) : [],
  })
  return { active, effective, restricted: isRestricted(effective) }
}

export const restrictedActor = () =>
  err(
    appError(
      'profile/restricted',
      'a restricted profile cannot act on the account or on other profiles',
    ),
  )
