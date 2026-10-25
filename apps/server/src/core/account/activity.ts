/** "Last activity and device, playing or not" of an account (§15 Accounts). */
export type AccountActivity = {
  accountId: string
  /** The most recently used session, revoked or not. */
  lastSeenAt?: Date
  lastDeviceName?: string
  /** Sessions and tokens neither revoked nor expired. */
  activeSessions: number
  /** Profiles with a playback session that is neither ended nor stale. */
  playingProfileIds: string[]
}

/** Read model over `sessions` and `playback_sessions`. */
export type AccountActivityQuery = (input: { now: Date }) => Map<string, AccountActivity>
