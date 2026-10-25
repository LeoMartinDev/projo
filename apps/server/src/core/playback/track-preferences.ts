/**
 * §6.4 `track_preferences`: the audio / subtitle memory of a profile on a movie or a series
 * (§11.3), written when the viewer changes a track, read first by the §11.2 cascade.
 */
export type TrackPreferences = {
  profileId: string
  /** The movie, or the series of the episode played. */
  itemId: string
  audioLanguage?: string
  subtitleLanguage?: string
  subtitlesEnabled: boolean
  updatedAt: Date
}

export type TrackPreferenceRepository = {
  find: (key: { profileId: string; itemId: string }) => TrackPreferences | undefined
  /** Insert or replace. */
  save: (preferences: TrackPreferences) => void
  /** `false` when there was nothing to delete. */
  delete: (key: { profileId: string; itemId: string }) => boolean
}
