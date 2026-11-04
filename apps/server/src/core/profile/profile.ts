import type {
  AvatarColor,
  ContentRatingTier,
  LibraryAccess,
  SubtitleMode,
  UiLocale,
} from '@projo/shared/api/profiles'

export type Profile = {
  id: string
  accountId: string
  name: string
  avatarColor: AvatarColor
  pinHash?: string
  maxContentRating?: ContentRatingTier
  libraryAccess: LibraryAccess
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
  listByAccount: (accountId: string) => Profile[]
  create: (profile: Profile, limit: { maxPerAccount: number }) => boolean
  update: (profile: Profile) => void
  delete: (id: string) => void
  unknownLibraryIds: (ids: readonly string[]) => string[]
}

export const maxProfilesPerAccount = 5

export const avatarColors: readonly AvatarColor[] = [
  'blue',
  'terracotta',
  'sage',
  'violet',
  'slate',
  'honey',
]

export const nextAvatarColor = (used: readonly AvatarColor[]): AvatarColor =>
  avatarColors.find((color) => !used.includes(color)) ?? avatarColors[used.length % 6] ?? 'blue'

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
