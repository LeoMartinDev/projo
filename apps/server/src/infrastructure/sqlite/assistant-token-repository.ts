import { and, desc, eq, isNull } from 'drizzle-orm'

import type { AssistantToken, AssistantTokenRepository } from '../../core/auth/assistant-token.ts'
import type { Db } from './database.ts'
import { fromIso, stripNulls, toIso, toNullable } from './rows.ts'
import { assistantTokens } from './schema/accounts.ts'

const toAssistantToken = (row: typeof assistantTokens.$inferSelect): AssistantToken => {
  const { lastUsedAt, revokedAt, createdAt, ...rest } = stripNulls(row)
  return {
    ...rest,
    createdAt: fromIso(createdAt),
    ...(lastUsedAt === undefined ? {} : { lastUsedAt: fromIso(lastUsedAt) }),
    ...(revokedAt === undefined ? {} : { revokedAt: fromIso(revokedAt) }),
  }
}

export const createSqliteAssistantTokenRepository = ({
  db,
}: {
  db: Db
}): AssistantTokenRepository => ({
  create: (token) =>
    toAssistantToken(
      db
        .insert(assistantTokens)
        .values({
          id: token.id,
          accountId: token.accountId,
          profileId: token.profileId,
          kind: token.kind,
          clientId: toNullable(token.clientId),
          name: token.name,
          tokenHash: toNullable(token.tokenHash),
          createdAt: toIso(token.createdAt),
          lastUsedAt: token.lastUsedAt === undefined ? null : toIso(token.lastUsedAt),
          revokedAt: token.revokedAt === undefined ? null : toIso(token.revokedAt),
        })
        .returning()
        .get(),
    ),
  findById: (id) => {
    const row = db.select().from(assistantTokens).where(eq(assistantTokens.id, id)).get()
    return row && toAssistantToken(row)
  },
  findByTokenHash: (tokenHash) => {
    const row = db
      .select()
      .from(assistantTokens)
      .where(eq(assistantTokens.tokenHash, tokenHash))
      .get()
    return row && toAssistantToken(row)
  },
  listActiveByAccount: (accountId) =>
    db
      .select()
      .from(assistantTokens)
      .where(and(eq(assistantTokens.accountId, accountId), isNull(assistantTokens.revokedAt)))
      .orderBy(desc(assistantTokens.createdAt), desc(assistantTokens.id))
      .all()
      .map(toAssistantToken),
  revoke: ({ id, accountId, revokedAt }) => {
    const live = and(
      eq(assistantTokens.id, id),
      accountId === undefined ? undefined : eq(assistantTokens.accountId, accountId),
      isNull(assistantTokens.revokedAt),
    )
    const found = db.select({ id: assistantTokens.id }).from(assistantTokens).where(live).get()
    if (found === undefined) return false
    db.update(assistantTokens)
      .set({ revokedAt: toIso(revokedAt) })
      .where(live)
      .run()
    return true
  },
  touch: ({ id, lastUsedAt }) => {
    db.update(assistantTokens)
      .set({ lastUsedAt: toIso(lastUsedAt) })
      .where(eq(assistantTokens.id, id))
      .run()
  },
})
