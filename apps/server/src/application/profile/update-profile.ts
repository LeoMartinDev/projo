import { type AppError, err, ok, type Result } from '@projo/shared'
import type { AccountRole } from '@projo/shared/api/auth'
import type { AvatarColor, ContentRatingTier, LibraryAccess } from '@projo/shared/api/profiles'

import type { PasswordHasher } from '../../core/auth/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { Profile, ProfileRepository } from '../../core/profile/profile.ts'
import { isWithin, mayWiden } from '../../core/profile/restrictions.ts'
import type { CheckPin, CheckPinError } from './check-pin.ts'
import { type AccountActionError, actingProfile, restrictedActor } from './shared/acting-profile.ts'
import { type ProfileActor, reachableProfile, unlockProfile } from './shared/profile-actor.ts'
import { adminOnly, lastUnrestricted, profileNotFound } from './shared/profile-errors.ts'
import type { Optional, ProfileSettings } from './shared/profile-input.ts'
import {
  hashPin,
  locksOutAdmin,
  restrictionsOf,
  unknownLibraries,
} from './shared/profile-restrictions.ts'

type Deps = {
  profileRepository: Pick<
    ProfileRepository,
    'findById' | 'listByAccount' | 'unknownLibraryIds' | 'update'
  >
  passwordHasher: PasswordHasher
  checkPin: CheckPin
  accountRole: (accountId: string) => AccountRole | undefined
  profileChanged: (profileId: string) => void
  logger: Logger
}

export type UpdateProfileInput = Optional<
  ProfileSettings & {
    name: string
    avatarColor: AvatarColor
    pin: string
    currentPin: string
    libraryAccess: LibraryAccess
    libraryIds: readonly string[]
    maxContentRating: ContentRatingTier | ''
  }
>

export type UpdateProfileError =
  | AppError<
      | 'profile/not_found'
      | 'profile/unknown_library'
      | 'profile/admin_only'
      | 'profile/last_unrestricted'
    >
  | AccountActionError
  | CheckPinError

export const updateProfileFactory =
  ({ profileRepository, passwordHasher, checkPin, accountRole, profileChanged, logger }: Deps) =>
  async ({
    actor,
    profileId,
    input,
  }: {
    actor: ProfileActor
    profileId: string
    input: UpdateProfileInput
  }): Promise<Result<Profile, UpdateProfileError>> => {
    const profile = reachableProfile(profileRepository, actor, profileId)
    if (profile === undefined) return profileNotFound(profileId)
    const acting = actingProfile(profileRepository, actor)
    if (acting.restricted && (profile.id !== acting.active?.id || input.pin !== undefined)) {
      return restrictedActor()
    }
    const unlocked = await unlockProfile(checkPin, actor, profile, input.currentPin)
    if (!unlocked.ok) return unlocked

    const libraryAccess = input.libraryAccess ?? profile.libraryAccess
    const maxContentRating =
      input.maxContentRating === ''
        ? undefined
        : (input.maxContentRating ?? profile.maxContentRating)
    const restrictions = restrictionsOf({
      libraryAccess,
      libraryIds:
        libraryAccess === 'all' ? [] : [...new Set(input.libraryIds ?? profile.libraryIds)],
      ...(maxContentRating === undefined ? {} : { maxContentRating }),
    })
    if (
      !isWithin(restrictions, profile) &&
      !mayWiden({ role: actor.role, activeRestrictions: acting.active })
    ) {
      return adminOnly()
    }
    const unknown = unknownLibraries(profileRepository, restrictions)
    if (unknown !== undefined) return err(unknown)
    if (
      locksOutAdmin({ profileRepository, accountRole }, profile.accountId, (all) =>
        all.map((p) => (p.id === profile.id ? restrictions : p)),
      )
    ) {
      return lastUnrestricted(profile.accountId)
    }

    const { pinHash: previousPin, maxContentRating: _previousRating, ...kept } = profile
    const pinHash = input.pin === undefined ? previousPin : await hashPin(passwordHasher, input.pin)
    const updated: Profile = {
      ...kept,
      name: input.name ?? profile.name,
      avatarColor: input.avatarColor ?? profile.avatarColor,
      uiLocale: input.uiLocale ?? profile.uiLocale,
      audioLanguage: input.audioLanguage ?? profile.audioLanguage,
      subtitleLanguage: input.subtitleLanguage ?? profile.subtitleLanguage,
      subtitleMode: input.subtitleMode ?? profile.subtitleMode,
      animeOriginalAudio: input.animeOriginalAudio ?? profile.animeOriginalAudio,
      autoplayNext: input.autoplayNext ?? profile.autoplayNext,
      autoSkipIntro: input.autoSkipIntro ?? profile.autoSkipIntro,
      autoSkipCredits: input.autoSkipCredits ?? profile.autoSkipCredits,
      ...restrictions,
      libraryIds: [...restrictions.libraryIds],
      ...(pinHash === undefined ? {} : { pinHash }),
    }
    profileRepository.update(updated)
    profileChanged(profile.id)
    logger.info('profile updated', { accountId: actor.accountId, profileId: profile.id })
    return ok(updated)
  }

export type UpdateProfile = ReturnType<typeof updateProfileFactory>
