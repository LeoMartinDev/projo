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
  /** The resolved active profile, when it belongs to the account. */
  active: Profile | undefined
  /** What the actor acts as: `active`, else the account's most restricted profile. */
  effective: ProfileRestrictions
  restricted: boolean
}

/**
 * Who an actor acts as (§14). A restricted profile (selected libraries or a maximum rating) does
 * not act on the account: devices and sessions, bearer tokens, password, other profiles, PINs.
 * Without a resolved active profile (refused or missing `X-Profile-Id`, "Who's watching?" not
 * answered), the actor is the account's most restricted profile.
 */
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
