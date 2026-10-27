import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { AccountRole } from '@projo/shared/api/auth'
import type {
  AvatarColor,
  ContentRatingTier,
  LibraryAccess,
  SubtitleMode,
  UiLocale,
} from '@projo/shared/api/profiles'

import { removesLastUnrestricted } from '../../core/account/last-admin.ts'
import type { PasswordHasher } from '../../core/auth/ports.ts'
import type { SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import {
  maxProfilesPerAccount,
  newProfile,
  nextAvatarColor,
  type Profile,
  type ProfileRepository,
} from '../../core/profile/profile.ts'
import {
  isWithin,
  mayWiden,
  type ProfileRestrictions,
  unrestricted,
} from '../../core/profile/restrictions.ts'
import { type AccountActionError, accountActionsFactory } from './account-actions.ts'
import type { CheckPin, CheckPinError } from './pin.ts'

/** Who acts: the authenticated account, its session and the request's active profile. */
export type ProfileActor = {
  accountId: string
  role: AccountRole
  sessionId: string
  activeProfileId?: string
}

type Deps = {
  profileRepository: ProfileRepository
  sessionRepository: SessionRepository
  passwordHasher: PasswordHasher
  checkPin: CheckPin
  playbackSessions: PlaybackSessionTerminator
  /** The role of an account, `undefined` when it does not exist. */
  accountRole: (accountId: string) => AccountRole | undefined
  /** Called after any change of a profile (cached visibility scopes). */
  profileChanged: (profileId: string) => void
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

type ProfileSettings = {
  uiLocale: UiLocale
  audioLanguage: string
  subtitleLanguage: string
  subtitleMode: SubtitleMode
  animeOriginalAudio: boolean
  autoplayNext: boolean
  autoSkipIntro: boolean
  autoSkipCredits: boolean
}

/** Every key optional, `undefined` accepted (validated request bodies). */
type Optional<T> = { [K in keyof T]?: T[K] | undefined }

export type CreateProfileInput = Optional<
  ProfileSettings & {
    avatarColor: AvatarColor
    pin: string
    libraryAccess: LibraryAccess
    libraryIds: readonly string[]
    maxContentRating: ContentRatingTier
  }
> & { name: string }

export type UpdateProfileInput = Optional<
  ProfileSettings & {
    name: string
    avatarColor: AvatarColor
    /** `''` removes the PIN. */
    pin: string
    /** Proves the PIN of a locked profile that is not the active one. */
    currentPin: string
    libraryAccess: LibraryAccess
    libraryIds: readonly string[]
    /** `''` removes the limit. */
    maxContentRating: ContentRatingTier | ''
  }
>

export type CreateProfileError =
  | AppError<'profile/limit_reached' | 'profile/unknown_library' | 'profile/admin_only'>
  | AccountActionError
export type UpdateProfileError =
  | AppError<
      | 'profile/not_found'
      | 'profile/unknown_library'
      | 'profile/admin_only'
      | 'profile/last_unrestricted'
    >
  | AccountActionError
  | CheckPinError
export type DeleteProfileError =
  | AppError<'profile/not_found' | 'profile/last_profile' | 'profile/last_unrestricted'>
  | AccountActionError
  | CheckPinError
export type SelectProfileError = AppError<'profile/not_found'> | CheckPinError

const restrictionsOf = ({
  libraryAccess,
  libraryIds,
  maxContentRating,
}: ProfileRestrictions): ProfileRestrictions => ({
  libraryAccess,
  libraryIds,
  ...(maxContentRating === undefined ? {} : { maxContentRating }),
})

const notFound = (profileId: string) =>
  err(appError('profile/not_found', 'profile not found', { context: { profileId } }))

const adminOnly = () =>
  err(
    appError(
      'profile/admin_only',
      'only an admin acting from an unrestricted profile may widen library access or rating',
    ),
  )

const lastUnrestricted = (accountId: string) =>
  err(
    appError(
      'profile/last_unrestricted',
      'an admin account keeps at least one unrestricted profile',
      { context: { accountId } },
    ),
  )

const restrictedActor = () =>
  err(
    appError(
      'profile/restricted',
      'a restricted profile cannot act on the account or on other profiles',
    ),
  )

/** Use cases of `/profiles` (§13.6, §14). */
export const profilesFactory = ({
  profileRepository,
  sessionRepository,
  passwordHasher,
  checkPin,
  playbackSessions,
  accountRole,
  profileChanged,
  clock,
  ids,
  logger,
}: Deps) => {
  const accountActions = accountActionsFactory({ profileRepository })
  /** §14: the resolved active profile, and whether the actor is restricted (none resolved: the
   * account's most restricted profile). */
  const actingAs = (actor: ProfileActor) =>
    accountActions.actingProfile({
      accountId: actor.accountId,
      activeProfileId: actor.activeProfileId,
    })

  /** The profiles of the actor's account; an admin reaches every profile. */
  const reachable = (actor: ProfileActor, profileId: string): Profile | undefined => {
    const profile = profileRepository.findById(profileId)
    if (profile === undefined) return undefined
    return profile.accountId === actor.accountId || actor.role === 'admin' ? profile : undefined
  }

  /**
   * A PIN-protected profile is edited from itself (it was unlocked to become active), by an admin
   * managing another account, or with its PIN.
   */
  const unlock = (actor: ProfileActor, profile: Profile, currentPin: string | undefined) => {
    const exempt =
      profile.id === actor.activeProfileId ||
      (actor.role === 'admin' && profile.accountId !== actor.accountId)
    return exempt ? Promise.resolve(ok()) : checkPin(profile, currentPin)
  }

  const unknownLibraries = (restrictions: ProfileRestrictions) => {
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

  const hashPin = (pin: string | undefined) =>
    pin === undefined || pin === '' ? Promise.resolve(undefined) : passwordHasher.hash(pin)

  /** §14: the change (`after` maps the account's profiles) leaves an admin account unable to
   * administer. */
  const locksOutAdmin = (
    accountId: string,
    after: (profiles: Profile[]) => ProfileRestrictions[],
  ) => {
    const before = profileRepository.listByAccount(accountId)
    return removesLastUnrestricted({ role: accountRole(accountId), before, after: after(before) })
  }

  const limitReached = () =>
    err(
      appError('profile/limit_reached', 'an account has at most 5 profiles', {
        context: { limit: maxProfilesPerAccount },
      }),
    )

  const createIn = async ({
    accountId,
    ceiling,
    input,
  }: {
    accountId: string
    ceiling: ProfileRestrictions
    input: CreateProfileInput
  }): Promise<Result<Profile, CreateProfileError>> => {
    if (profileRepository.listByAccount(accountId).length >= maxProfilesPerAccount) {
      return limitReached()
    }
    const libraryAccess = input.libraryAccess ?? ceiling.libraryAccess
    const maxContentRating = input.maxContentRating ?? ceiling.maxContentRating
    const restrictions = restrictionsOf({
      libraryAccess,
      libraryIds:
        libraryAccess === 'all' ? [] : [...new Set(input.libraryIds ?? ceiling.libraryIds)],
      ...(maxContentRating === undefined ? {} : { maxContentRating }),
    })
    if (!isWithin(restrictions, ceiling)) return adminOnly()
    const unknown = unknownLibraries(restrictions)
    if (unknown !== undefined) return err(unknown)

    // Hashed before counting: the count and the insert must not be separated by an `await`
    // (parallel requests would all pass the limit, §14).
    const pinHash = await hashPin(input.pin)
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

  return {
    list: ({ accountId }: { accountId: string }): Profile[] =>
      profileRepository.listByAccount(accountId),

    create: ({
      actor,
      input,
    }: {
      actor: ProfileActor
      input: CreateProfileInput
    }): Promise<Result<Profile, CreateProfileError>> => {
      // §14: a restricted profile (or no resolved profile on an account that has restricted
      // ones) does not create profiles. Otherwise the actor sees everything, so may the new one.
      const acting = actingAs(actor)
      if (acting.restricted) return Promise.resolve(restrictedActor())
      return createIn({ accountId: actor.accountId, ceiling: acting.effective, input })
    },

    /**
     * `POST /admin/accounts/:id/profiles` (§15 Accounts): an admin (acting from an unrestricted
     * profile, `requireAdmin`) adds a profile to any account, within the limit of 5.
     */
    createForAccount: ({
      accountId,
      input,
    }: {
      accountId: string
      input: CreateProfileInput
    }): Promise<Result<Profile, CreateProfileError | AppError<'account/not_found'>>> =>
      accountRole(accountId) === undefined
        ? Promise.resolve(
            err(appError('account/not_found', 'account not found', { context: { accountId } })),
          )
        : createIn({ accountId, ceiling: unrestricted, input }),

    update: async ({
      actor,
      profileId,
      input,
    }: {
      actor: ProfileActor
      profileId: string
      input: UpdateProfileInput
    }): Promise<Result<Profile, UpdateProfileError>> => {
      const profile = reachable(actor, profileId)
      if (profile === undefined) return notFound(profileId)
      const acting = actingAs(actor)
      // §14: a restricted profile edits only itself, and not its PIN.
      if (acting.restricted && (profile.id !== acting.active?.id || input.pin !== undefined)) {
        return restrictedActor()
      }
      const unlocked = await unlock(actor, profile, input.currentPin)
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
      const unknown = unknownLibraries(restrictions)
      if (unknown !== undefined) return err(unknown)
      if (
        locksOutAdmin(profile.accountId, (all) =>
          all.map((p) => (p.id === profile.id ? restrictions : p)),
        )
      ) {
        return lastUnrestricted(profile.accountId)
      }

      const { pinHash: previousPin, maxContentRating: _previousRating, ...kept } = profile
      const pinHash = input.pin === undefined ? previousPin : await hashPin(input.pin)
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
    },

    delete: async ({
      actor,
      profileId,
      currentPin,
    }: {
      actor: ProfileActor
      profileId: string
      currentPin?: string
    }): Promise<Result<void, DeleteProfileError>> => {
      const profile = reachable(actor, profileId)
      if (profile === undefined) return notFound(profileId)
      if (actingAs(actor).restricted) return restrictedActor()
      const unlocked = await unlock(actor, profile, currentPin)
      if (!unlocked.ok) return unlocked
      if (profileRepository.listByAccount(profile.accountId).length <= 1) {
        return err(
          appError('profile/last_profile', 'an account keeps at least one profile', {
            context: { profileId },
          }),
        )
      }
      if (locksOutAdmin(profile.accountId, (all) => all.filter((p) => p.id !== profile.id))) {
        return lastUnrestricted(profile.accountId)
      }
      // Its playback stops first (ffmpeg, player told): the cascade drops the session rows.
      playbackSessions.endWithin({ profileIds: [profile.id] })
      profileRepository.delete(profile.id)
      profileChanged(profile.id)
      logger.info('profile deleted', { accountId: profile.accountId, profileId: profile.id })
      return ok()
    },

    /** `POST /profiles/:id/verify-pin`: a check only, on a profile of the account. */
    verifyPin: async ({
      actor,
      profileId,
      pin,
    }: {
      actor: ProfileActor
      profileId: string
      pin: string
    }): Promise<Result<void, SelectProfileError>> => {
      const profile = profileRepository.findById(profileId)
      if (profile === undefined || profile.accountId !== actor.accountId) return notFound(profileId)
      return checkPin(profile, pin)
    },

    /**
     * `POST /profiles/:id/select` (§13.6): the PIN if any, then the profile becomes this
     * session's last profile, restored on the next visit and accepted in `X-Profile-Id`.
     */
    select: async ({
      actor,
      profileId,
      pin,
    }: {
      actor: ProfileActor
      profileId: string
      pin?: string
    }): Promise<Result<Profile, SelectProfileError>> => {
      const profile = profileRepository.findById(profileId)
      if (profile === undefined || profile.accountId !== actor.accountId) return notFound(profileId)
      const unlocked = await checkPin(profile, pin)
      if (!unlocked.ok) return unlocked
      sessionRepository.setLastProfile({ id: actor.sessionId, profileId: profile.id })
      return ok(profile)
    },
  }
}

export type Profiles = ReturnType<typeof profilesFactory>
