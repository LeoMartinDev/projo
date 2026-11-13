import { type AppError, err, ok, type Result } from '@projo/shared'
import type { AvatarColor, ContentRatingTier, LibraryAccess } from '@projo/shared/api/profiles'

import type { PasswordHasher } from '../../../core/auth/ports.ts'
import type { Clock } from '../../../core/clock.ts'
import type { IdGenerator } from '../../../core/ids.ts'
import type { Logger } from '../../../core/logger.ts'
import {
  maxProfilesPerAccount,
  newProfile,
  nextAvatarColor,
  type Profile,
  type ProfileRepository,
} from '../../../core/profile/profile.ts'
import { isWithin, type ProfileRestrictions } from '../../../core/profile/restrictions.ts'
import type { AccountActionError } from './acting-profile.ts'
import { adminOnly, limitReached } from './profile-errors.ts'
import type { Optional, ProfileSettings } from './profile-input.ts'
import { hashPin, restrictionsOf, unknownLibraries } from './profile-restrictions.ts'

export type CreateProfileInput = Optional<
  ProfileSettings & {
    avatarColor: AvatarColor
    pin: string
    libraryAccess: LibraryAccess
    libraryIds: readonly string[]
    maxContentRating: ContentRatingTier
  }
> & { name: string }

export type CreateProfileError =
  | AppError<'profile/limit_reached' | 'profile/unknown_library' | 'profile/admin_only'>
  | AccountActionError

export type ProfileCreationDeps = {
  profileRepository: Pick<ProfileRepository, 'listByAccount' | 'unknownLibraryIds' | 'create'>
  passwordHasher: PasswordHasher
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

/** A new profile in an account, within the restrictions of whoever creates it. */
export const createProfileInAccount = async (
  { profileRepository, passwordHasher, clock, ids, logger }: ProfileCreationDeps,
  {
    accountId,
    ceiling,
    input,
  }: {
    accountId: string
    ceiling: ProfileRestrictions
    input: CreateProfileInput
  },
): Promise<Result<Profile, CreateProfileError>> => {
  if (profileRepository.listByAccount(accountId).length >= maxProfilesPerAccount) {
    return limitReached()
  }
  const libraryAccess = input.libraryAccess ?? ceiling.libraryAccess
  const maxContentRating = input.maxContentRating ?? ceiling.maxContentRating
  const restrictions = restrictionsOf({
    libraryAccess,
    libraryIds: libraryAccess === 'all' ? [] : [...new Set(input.libraryIds ?? ceiling.libraryIds)],
    ...(maxContentRating === undefined ? {} : { maxContentRating }),
  })
  if (!isWithin(restrictions, ceiling)) return adminOnly()
  const unknown = unknownLibraries(profileRepository, restrictions)
  if (unknown !== undefined) return err(unknown)

  const pinHash = await hashPin(passwordHasher, input.pin)
  const existing = profileRepository.listByAccount(accountId)
  const uiLocale = input.uiLocale ?? 'fr'
  const base = newProfile({
    id: ids.next(),
    accountId,
    name: input.name,
    avatarColor:
      input.avatarColor ?? nextAvatarColor(existing.map((profile) => profile.avatarColor)),
    uiLocale,
    createdAt: clock.now(),
  })
  const profile: Profile = {
    ...base,
    ...restrictions,
    libraryIds: [...restrictions.libraryIds],
    audioLanguage: input.audioLanguage ?? base.audioLanguage,
    subtitleLanguage: input.subtitleLanguage ?? base.subtitleLanguage,
    subtitleMode: input.subtitleMode ?? base.subtitleMode,
    animeOriginalAudio: input.animeOriginalAudio ?? base.animeOriginalAudio,
    autoplayNext: input.autoplayNext ?? base.autoplayNext,
    autoSkipIntro: input.autoSkipIntro ?? base.autoSkipIntro,
    autoSkipCredits: input.autoSkipCredits ?? base.autoSkipCredits,
    ...(pinHash === undefined ? {} : { pinHash }),
  }
  if (!profileRepository.create(profile, { maxPerAccount: maxProfilesPerAccount })) {
    return limitReached()
  }
  logger.info('profile created', { accountId, profileId: profile.id })
  return ok(profile)
}
