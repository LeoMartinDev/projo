import { and, desc, eq, gt, isNull } from 'drizzle-orm'

import type { AccountActivity, AccountActivityQuery } from '../../core/account/activity.ts'
import { sessionTimings } from '../../core/playback/session.ts'
import type { Db } from './database.ts'
import { fromIso, toIso } from './rows.ts'
import { sessions } from './schema/accounts.ts'
import { playbackSessions } from './schema/playback.ts'

/** Last activity, open sessions and current playback of every account (admin list, §15). */
export const createSqliteAccountActivity =
  ({ db }: { db: Db }): AccountActivityQuery =>
  ({ now }) => {
    const byAccount = new Map<string, AccountActivity>()
    const entry = (accountId: string): AccountActivity => {
      const existing = byAccount.get(accountId)
      if (existing !== undefined) return existing
      const created: AccountActivity = { accountId, activeSessions: 0, playingProfileIds: [] }
      byAccount.set(accountId, created)
      return created
    }

    const nowIso = toIso(now)
    // Most recently seen first: the first row of an account is its last activity.
    for (const row of db
      .select({
        accountId: sessions.accountId,
        deviceName: sessions.deviceName,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .orderBy(desc(sessions.lastSeenAt), desc(sessions.id))
      .all()) {
      const activity = entry(row.accountId)
      if (activity.lastSeenAt === undefined) {
        activity.lastSeenAt = fromIso(row.lastSeenAt)
        activity.lastDeviceName = row.deviceName
      }
      if (row.revokedAt === null && row.expiresAt > nowIso) activity.activeSessions += 1
    }

    const freshAfter = toIso(new Date(now.getTime() - sessionTimings.expireAfterMs))
    for (const row of db
      .selectDistinct({ accountId: sessions.accountId, profileId: playbackSessions.profileId })
      .from(playbackSessions)
      .innerJoin(sessions, eq(sessions.id, playbackSessions.sessionId))
      .where(
        and(isNull(playbackSessions.endedAt), gt(playbackSessions.lastHeartbeatAt, freshAfter)),
      )
      .all()) {
      entry(row.accountId).playingProfileIds.push(row.profileId)
    }
    return byAccount
  }
