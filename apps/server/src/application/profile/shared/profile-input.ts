import type { SubtitleMode, UiLocale } from '@projo/shared/api/profiles'

export type ProfileSettings = {
  uiLocale: UiLocale
  audioLanguage: string
  subtitleLanguage: string
  subtitleMode: SubtitleMode
  animeOriginalAudio: boolean
  autoplayNext: boolean
  autoSkipIntro: boolean
  autoSkipCredits: boolean
}

export type Optional<T> = { [K in keyof T]?: T[K] | undefined }
