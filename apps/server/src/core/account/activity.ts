export type AccountActivity = {
  accountId: string
  lastSeenAt?: Date
  lastDeviceName?: string
  activeSessions: number
  playingProfileIds: string[]
}

export type AccountActivityQuery = (input: { now: Date }) => Map<string, AccountActivity>
