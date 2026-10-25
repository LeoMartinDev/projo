import type {
  AvatarColor,
  ContentRatingTier,
  LibraryAccess,
  SubtitleMode,
  UiLocale,
} from '@projo/shared/api/profiles'

/** §6.1 `profiles` + `profile_libraries`. Reading progress and preferences belong to a profile. */
export type Profile = {
  id: string
  accountId: string
  name: string
  avatarColor: AvatarColor
  pinHash?: string
  /** §14: absent = no limit. */
  maxContentRating?: ContentRatingTier
  libraryAccess: LibraryAccess
  /** `profile_libraries`: the libraries seen when `libraryAccess = selected` (empty for `all`). */
  libraryIds: string[]
  uiLocale: UiLocale
  audioLanguage: string
  subtitleLanguage: string
  subtitleMode: SubtitleMode
  animeOriginalAudio: boolean
  autoplayNext: boolean
  autoSkipIntro: boolean
  autoSkipCredits: boolean
  createdAt: Date
}

export type ProfileRepository = {
  findById: (id: string) => Profile | undefined
  /** Oldest first. */
  listByAccount: (accountId: string) => Profile[]
  /**
   * Inserts the profile and its `profile_libraries` unless its account already has
   * `maxPerAccount` profiles (counted in the same transaction); `false` when refused.
   */
  create: (profile: Profile, limit: { maxPerAccount: number }) => boolean
  /** Replaces every column and the `profile_libraries` of `profile.id`. */
  update: (profile: Profile) => void
  /** Cascades to progress, lists, preferences, playback sessions (§6.1). */
  delete: (id: string) => void
  /** The ids among `ids` that are not libraries. */
  unknownLibraryIds: (ids: readonly string[]) => string[]
}

/** §14 / §24: 1 to 5 profiles per account. */
export const maxProfilesPerAccount = 5

export const avatarColors: readonly AvatarColor[] = [
  'blue',
  'terracotta',
  'sage',
  'violet',
  'slate',
  'honey',
]

/** The first colour not used yet by the account (the order of the design palette). */
export const nextAvatarColor = (used: readonly AvatarColor[]): AvatarColor =>
  avatarColors.find((color) => !used.includes(color)) ?? avatarColors[used.length % 6] ?? 'blue'

/** Defaults of §11.1 / §12.4 for a new profile: languages follow the interface language. */
export const newProfile = ({
  id,
  accountId,
  name,
  avatarColor,
  uiLocale,
  createdAt,
}: {
  id: string
  accountId: string
  name: string
  avatarColor: AvatarColor
  uiLocale: UiLocale
  createdAt: Date
}): Profile => ({
  id,
  accountId,
  name,
  avatarColor,
  libraryAccess: 'all',
  libraryIds: [],
  uiLocale,
  audioLanguage: uiLocale,
  subtitleLanguage: uiLocale,
  subtitleMode: 'when_audio_differs',
  animeOriginalAudio: true,
  autoplayNext: true,
  autoSkipIntro: false,
  autoSkipCredits: false,
  createdAt,
})
