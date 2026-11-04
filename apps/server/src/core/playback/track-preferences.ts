export type TrackPreferences = {
  profileId: string
  itemId: string
  audioLanguage?: string
  subtitleLanguage?: string
  subtitlesEnabled: boolean
  updatedAt: Date
}

export type TrackPreferenceRepository = {
  find: (key: { profileId: string; itemId: string }) => TrackPreferences | undefined
  save: (preferences: TrackPreferences) => void
  delete: (key: { profileId: string; itemId: string }) => boolean
}
