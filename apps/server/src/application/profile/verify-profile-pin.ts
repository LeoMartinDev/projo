import type { Result } from '@projo/shared'

import type { ProfileRepository } from '../../core/profile/profile.ts'
import type { CheckPin } from './check-pin.ts'
import type { ProfileActor } from './shared/profile-actor.ts'
import { profileNotFound } from './shared/profile-errors.ts'
import type { SelectProfileError } from './select-profile.ts'

type Deps = {
  profileRepository: Pick<ProfileRepository, 'findById'>
  checkPin: CheckPin
}

export type VerifyProfilePinError = SelectProfileError

export const verifyProfilePinFactory =
  ({ profileRepository, checkPin }: Deps) =>
  async ({
    actor,
    profileId,
    pin,
  }: {
    actor: ProfileActor
    profileId: string
    pin: string
  }): Promise<Result<void, VerifyProfilePinError>> => {
    const profile = profileRepository.findById(profileId)
    if (profile === undefined || profile.accountId !== actor.accountId) {
      return profileNotFound(profileId)
    }
    return checkPin(profile, pin)
  }

export type VerifyProfilePin = ReturnType<typeof verifyProfilePinFactory>
