import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm'

import type { Pairing, PairingRepository } from '../../core/auth/pairing.ts'
import type { Db } from './database.ts'
import { fromIso, fromIsoNullable, toIso, toNullable } from './rows.ts'
import { pairings } from './schema/accounts.ts'

type PairingRow = typeof pairings.$inferSelect

const toPairing = (row: PairingRow): Pairing => {
  const claimedAt = fromIsoNullable(row.claimedAt)
  return {
    id: row.id,
    accountId: row.accountId,
    createdBySessionId: row.createdBySessionId,
    codeHash: row.codeHash,
    createdAt: fromIso(row.createdAt),
    expiresAt: fromIso(row.expiresAt),
    ...(claimedAt === undefined ? {} : { claimedAt }),
    ...(row.claimedSessionId === null ? {} : { claimedSessionId: row.claimedSessionId }),
  }
}

export const createSqlitePairingRepository = ({ db }: { db: Db }): PairingRepository => ({
  create: (pairing) => {
    db.insert(pairings)
      .values({
        id: pairing.id,
        accountId: pairing.accountId,
        createdBySessionId: pairing.createdBySessionId,
        codeHash: pairing.codeHash,
        createdAt: toIso(pairing.createdAt),
        expiresAt: toIso(pairing.expiresAt),
        claimedAt: toNullable(pairing.claimedAt && toIso(pairing.claimedAt)),
        claimedSessionId: toNullable(pairing.claimedSessionId),
      })
      .run()
  },
  findByCodeHash: (codeHash) => {
    const row = db
      .select()
      .from(pairings)
      .where(eq(pairings.codeHash, codeHash))
      .orderBy(desc(pairings.createdAt), desc(pairings.id))
      .get()
    return row && toPairing(row)
  },
  listLiveByAccount: ({ accountId, now }) =>
    db
      .select()
      .from(pairings)
      .where(
        and(
          eq(pairings.accountId, accountId),
          isNull(pairings.claimedAt),
          gt(pairings.expiresAt, toIso(now)),
        ),
      )
      .orderBy(desc(pairings.createdAt), desc(pairings.id))
      .all()
      .map(toPairing),
  claim: ({ id, claimedAt, claimedSessionId }) =>
    db
      .update(pairings)
      .set({ claimedAt: toIso(claimedAt), claimedSessionId })
      .where(and(eq(pairings.id, id), isNull(pairings.claimedAt)))
      .returning({ id: pairings.id })
      .get() !== undefined,
  deleteExpiredBefore: (before) => {
    db.delete(pairings)
      .where(lt(pairings.expiresAt, toIso(before)))
      .run()
  },
})
