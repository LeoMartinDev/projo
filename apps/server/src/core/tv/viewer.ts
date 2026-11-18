/** Whether a profile has Live TV access (§29.6); an unknown profile has none. */
export type TvProfileAccess = { hasLiveTv: (profileId: string) => boolean }

/** A profile's favourite channels (§29.6), in the order they were added. */
export type TvFavoriteRepository = {
  /** Channel ids, oldest favourite first. */
  listOf: (profileId: string) => string[]
  /** Adds the channel last; a favourite already keeps its place. */
  add: (input: { profileId: string; channelId: string; at: Date }) => void
  remove: (input: { profileId: string; channelId: string }) => void
}
