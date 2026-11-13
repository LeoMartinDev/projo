import { ok } from '@projo/shared'
import type { AccountRole } from '@projo/shared/api/auth'

import type { Profile, ProfileRepository } from '../../../core/profile/profile.ts'
import type { CheckPin } from '../check-pin.ts'
import { actingProfile } from './acting-profile.ts'

export type ProfileActor = {
  accountId: string
  role: AccountRole
  sessionId: string
  activeProfileId?: string
}

export const actingAs = (
  profileRepository: Pick<ProfileRepository, 'findById' | 'listByAccount'>,
  actor: ProfileActor,
) =>
  actingProfile(profileRepository, {
    accountId: actor.accountId,
    activeProfileId: actor.activeProfileId,
  })

/** A profile of the actor's account, or of any account for an admin. */
export const reachableProfile = (
  profileRepository: Pick<ProfileRepository, 'findById'>,
  actor: ProfileActor,
  profileId: string,
): Profile | undefined => {
  const profile = profileRepository.findById(profileId)
  if (profile === undefined) return undefined
  return profile.accountId === actor.accountId || actor.role === 'admin' ? profile : undefined
}

/** The PIN of a profile, unless the actor is on it or is an admin acting on another account. */
export const unlockProfile = (
  checkPin: CheckPin,
  actor: ProfileActor,
  profile: Profile,
  currentPin: string | undefined,
) => {
  const exempt =
    profile.id === actor.activeProfileId ||
    (actor.role === 'admin' && profile.accountId !== actor.accountId)
  return exempt ? Promise.resolve(ok()) : checkPin(profile, currentPin)
}
