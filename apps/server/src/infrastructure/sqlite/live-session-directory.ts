import { inArray } from 'drizzle-orm'

import type { LiveSessionDirectory } from '../../core/tv/live-session.ts'
import type { Db } from './database.ts'
import { accounts, profiles, sessions } from './schema/accounts.ts'
import { tvChannels } from './schema/tv.ts'

const byId = <T extends { id: string }>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.id, row]))

/** Names of the accounts, profiles, devices and channels of the live sessions (§29.4). */
export const createSqliteLiveSessionDirectory = ({ db }: { db: Db }): LiveSessionDirectory => ({
  describe: (live) => {
    if (live.length === 0) return []
    const unique = (values: string[]) => [...new Set(values)]
    const accountRows = byId(
      db
        .select({ id: accounts.id, name: accounts.username })
        .from(accounts)
        .where(inArray(accounts.id, unique(live.map((s) => s.accountId))))
        .all(),
    )
    const profileRows = byId(
      db
        .select({ id: profiles.id, name: profiles.name, color: profiles.avatarColor })
        .from(profiles)
        .where(inArray(profiles.id, unique(live.map((s) => s.profileId))))
        .all(),
    )
    const deviceRows = byId(
      db
        .select({ id: sessions.id, device: sessions.deviceName })
        .from(sessions)
        .where(inArray(sessions.id, unique(live.map((s) => s.authSessionId))))
        .all(),
    )
    const channelRows = byId(
      db
        .select({ id: tvChannels.id, name: tvChannels.name, number: tvChannels.number })
        .from(tvChannels)
        .where(inArray(tvChannels.id, unique(live.map((s) => s.channelId))))
        .all(),
    )
    return live.flatMap((session) => {
      const account = accountRows.get(session.accountId)
      const profile = profileRows.get(session.profileId)
      const channel = channelRows.get(session.channelId)
      if (account === undefined || profile === undefined || channel === undefined) return []
      const device = deviceRows.get(session.authSessionId)?.device
      return [
        {
          id: session.id,
          account,
          profile,
          channel: {
            id: channel.id,
            name: channel.name,
            ...(channel.number === null ? {} : { number: channel.number }),
          },
          rendition: session.rendition,
          ...(device === undefined || device === '' ? {} : { device }),
          startedAt: session.startedAt,
          lastHeartbeatAt: session.lastHeartbeatAt,
        },
      ]
    })
  },
})
