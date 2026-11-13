import { type AppError, ok, type Result } from '@projo/shared'

import type { SessionRepository } from '../../core/auth/session.ts'
import type { Profile, ProfileRepository } from '../../core/profile/profile.ts'
import type { CheckPin, CheckPinError } from './check-pin.ts'
import type { ProfileActor } from './shared/profile-actor.ts'
import { profileNotFound } from './shared/profile-errors.ts'

type Deps = {
  profileRepository: Pick<ProfileRepository, 'findById'>
  sessionRepository: Pick<SessionRepository, 'setLastProfile'>
  checkPin: CheckPin
}

export type SelectProfileError = AppError<'profile/not_found'> | CheckPinError

export const selectProfileFactory =
  ({ profileRepository, sessionRepository, checkPin }: Deps) =>
  async ({
    actor,
    profileId,
    pin,
  }: {
    actor: ProfileActor
    profileId: string
    pin?: string
  }): Promise<Result<Profile, SelectProfileError>> => {
    const profile = profileRepository.findById(profileId)
    if (profile === undefined || profile.accountId !== actor.accountId) {
      return profileNotFound(profileId)
    }
    const unlocked = await checkPin(profile, pin)
    if (!unlocked.ok) return unlocked
    sessionRepository.setLastProfile({ id: actor.sessionId, profileId: profile.id })
    return ok(profile)
  }

export type SelectProfile = ReturnType<typeof selectProfileFactory>
