import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Profile, ProfileRepository } from '../../core/profile/profile.ts'
import {
  effectiveRestrictions,
  isRestricted,
  type ProfileRestrictions,
} from '../../core/profile/restrictions.ts'

type Deps = { profileRepository: ProfileRepository }

export type AccountActionError = AppError<'profile/restricted'>

export type ActingProfile = {
  active: Profile | undefined
  effective: ProfileRestrictions
  restricted: boolean
}

export const accountActionsFactory = ({ profileRepository }: Deps) => {
  const actingProfile = ({
    accountId,
    activeProfileId,
  }: {
    accountId: string
    activeProfileId: string | undefined
  }): ActingProfile => {
    const found =
      activeProfileId === undefined ? undefined : profileRepository.findById(activeProfileId)
    const active = found?.accountId === accountId ? found : undefined
    const effective = effectiveRestrictions({
      active,
      accountProfiles: active === undefined ? profileRepository.listByAccount(accountId) : [],
    })
    return { active, effective, restricted: isRestricted(effective) }
  }

  const ensureAllowed = (actor: {
    accountId: string
    activeProfileId: string | undefined
  }): Result<void, AccountActionError> =>
    actingProfile(actor).restricted
      ? err(
          appError(
            'profile/restricted',
            'a restricted profile cannot act on the account or on other profiles',
          ),
        )
      : ok()

  return { actingProfile, ensureAllowed }
}

export type AccountActions = ReturnType<typeof accountActionsFactory>
