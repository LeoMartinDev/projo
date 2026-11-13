import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { AccountRole } from '@projo/shared/api/auth'

import type { Logger } from '../../core/logger.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import type { ProfileRepository } from '../../core/profile/profile.ts'
import type { CheckPin, CheckPinError } from './check-pin.ts'
import { type AccountActionError, restrictedActor } from './shared/acting-profile.ts'
import {
  actingAs,
  type ProfileActor,
  reachableProfile,
  unlockProfile,
} from './shared/profile-actor.ts'
import { lastUnrestricted, profileNotFound } from './shared/profile-errors.ts'
import { locksOutAdmin } from './shared/profile-restrictions.ts'

type Deps = {
  profileRepository: Pick<ProfileRepository, 'findById' | 'listByAccount' | 'delete'>
  checkPin: CheckPin
  playbackSessions: PlaybackSessionTerminator
  accountRole: (accountId: string) => AccountRole | undefined
  profileChanged: (profileId: string) => void
  logger: Logger
}

export type DeleteProfileError =
  | AppError<'profile/not_found' | 'profile/last_profile' | 'profile/last_unrestricted'>
  | AccountActionError
  | CheckPinError

export const deleteProfileFactory =
  ({ profileRepository, checkPin, playbackSessions, accountRole, profileChanged, logger }: Deps) =>
  async ({
    actor,
    profileId,
    currentPin,
  }: {
    actor: ProfileActor
    profileId: string
    currentPin?: string
  }): Promise<Result<void, DeleteProfileError>> => {
    const profile = reachableProfile(profileRepository, actor, profileId)
    if (profile === undefined) return profileNotFound(profileId)
    if (actingAs(profileRepository, actor).restricted) return restrictedActor()
    const unlocked = await unlockProfile(checkPin, actor, profile, currentPin)
    if (!unlocked.ok) return unlocked
    if (profileRepository.listByAccount(profile.accountId).length <= 1) {
      return err(
        appError('profile/last_profile', 'an account keeps at least one profile', {
          context: { profileId },
        }),
      )
    }
    if (
      locksOutAdmin({ profileRepository, accountRole }, profile.accountId, (all) =>
        all.filter((p) => p.id !== profile.id),
      )
    ) {
      return lastUnrestricted(profile.accountId)
    }
    playbackSessions.endWithin({ profileIds: [profile.id] })
    profileRepository.delete(profile.id)
    profileChanged(profile.id)
    logger.info('profile deleted', { accountId: profile.accountId, profileId: profile.id })
    return ok()
  }

export type DeleteProfile = ReturnType<typeof deleteProfileFactory>
