import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm'

import type { Session, SessionRepository } from '../../core/auth/session.ts'
import type { Db } from './database.ts'
import { fromIso, fromIsoNullable, toIso } from './rows.ts'
import { sessions } from './schema/accounts.ts'

type SessionRow = typeof sessions.$inferSelect

const toSession = (row: SessionRow): Session => {
  const revokedAt = fromIsoNullable(row.revokedAt)
  return {
    id: row.id,
    accountId: row.accountId,
    kind: row.kind,
    tokenHash: row.tokenHash,
    deviceName: row.deviceName,
    userAgent: row.userAgent,
    createdAt: fromIso(row.createdAt),
    lastSeenAt: fromIso(row.lastSeenAt),
    expiresAt: fromIso(row.expiresAt),
    ...(row.lastProfileId === null ? {} : { lastProfileId: row.lastProfileId }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
  }
}

export const createSqliteSessionRepository = ({ db }: { db: Db }): SessionRepository => ({
  create: (session) =>
    toSession(
      db
        .insert(sessions)
        .values({
          id: session.id,
          accountId: session.accountId,
          kind: session.kind,
          tokenHash: session.tokenHash,
          deviceName: session.deviceName,
          userAgent: session.userAgent,
          lastProfileId: session.lastProfileId ?? null,
          createdAt: toIso(session.createdAt),
          lastSeenAt: toIso(session.lastSeenAt),
          expiresAt: toIso(session.expiresAt),
          revokedAt: session.revokedAt === undefined ? null : toIso(session.revokedAt),
        })
        .returning()
        .get(),
    ),
  findById: (id) => {
    const row = db.select().from(sessions).where(eq(sessions.id, id)).get()
    return row && toSession(row)
  },
  findByTokenHash: (tokenHash) => {
    const row = db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get()
    return row && toSession(row)
  },
  touch: ({ id, lastSeenAt, expiresAt }) => {
    db.update(sessions)
      .set({ lastSeenAt: toIso(lastSeenAt), expiresAt: toIso(expiresAt) })
      .where(eq(sessions.id, id))
      .run()
  },
  setLastProfile: ({ id, profileId }) => {
    db.update(sessions).set({ lastProfileId: profileId }).where(eq(sessions.id, id)).run()
  },
  revoke: ({ id, revokedAt }) => {
    db.update(sessions)
      .set({ revokedAt: toIso(revokedAt) })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .run()
  },
  listActiveByAccount: ({ accountId, now }) =>
    db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.accountId, accountId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, toIso(now)),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt), desc(sessions.id))
      .all()
      .map(toSession),
  revokeAllByAccount: ({ accountId, revokedAt, exceptId }) => {
    db.update(sessions)
      .set({ revokedAt: toIso(revokedAt) })
      .where(
        and(
          eq(sessions.accountId, accountId),
          isNull(sessions.revokedAt),
          exceptId === undefined ? undefined : ne(sessions.id, exceptId),
        ),
      )
      .run()
  },
})
