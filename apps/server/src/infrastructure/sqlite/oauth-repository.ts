import { and, eq, isNotNull, isNull, lt, notExists, or } from 'drizzle-orm'
import { z } from 'zod'

import type { OAuthClient, OAuthCode, OAuthRepository, OAuthToken } from '../../core/auth/oauth.ts'
import type { Db } from './database.ts'
import { fromIso, parseJsonColumn, stripNulls, toIso, toNullable } from './rows.ts'
import { assistantTokens, oauthClients, oauthCodes, oauthTokens } from './schema/accounts.ts'

const redirectUrisSchema = z.array(z.string())

const toClient = (row: typeof oauthClients.$inferSelect): OAuthClient => {
  const { createdAt, fetchedAt, lastUsedAt, redirectUris, ...rest } = stripNulls(row)
  return {
    ...rest,
    redirectUris: parseJsonColumn(redirectUrisSchema, redirectUris, 'oauth_clients.redirect_uris'),
    createdAt: fromIso(createdAt),
    ...(fetchedAt === undefined ? {} : { fetchedAt: fromIso(fetchedAt) }),
    ...(lastUsedAt === undefined ? {} : { lastUsedAt: fromIso(lastUsedAt) }),
  }
}

const toCode = (row: typeof oauthCodes.$inferSelect): OAuthCode => {
  const { expiresAt, usedAt, ...rest } = stripNulls(row)
  return {
    ...rest,
    expiresAt: fromIso(expiresAt),
    ...(usedAt === undefined ? {} : { usedAt: fromIso(usedAt) }),
  }
}

const toToken = (row: typeof oauthTokens.$inferSelect): OAuthToken => {
  const { expiresAt, rotatedAt, ...rest } = stripNulls(row)
  return {
    ...rest,
    expiresAt: fromIso(expiresAt),
    ...(rotatedAt === undefined ? {} : { rotatedAt: fromIso(rotatedAt) }),
  }
}

export const createSqliteOAuthRepository = ({ db }: { db: Db }): OAuthRepository => ({
  findClient: (clientId) => {
    const row = db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).get()
    return row && toClient(row)
  },
  findClientById: (id) => {
    const row = db.select().from(oauthClients).where(eq(oauthClients.id, id)).get()
    return row && toClient(row)
  },
  saveClient: (client) => {
    const values = {
      id: client.id,
      clientId: client.clientId,
      kind: client.kind,
      name: client.name,
      redirectUris: client.redirectUris,
      createdAt: toIso(client.createdAt),
      fetchedAt: client.fetchedAt === undefined ? null : toIso(client.fetchedAt),
      lastUsedAt: client.lastUsedAt === undefined ? null : toIso(client.lastUsedAt),
    }
    return toClient(
      db
        .insert(oauthClients)
        .values(values)
        .onConflictDoUpdate({
          target: oauthClients.clientId,
          set: {
            name: values.name,
            redirectUris: values.redirectUris,
            fetchedAt: values.fetchedAt,
          },
        })
        .returning()
        .get(),
    )
  },
  touchClient: ({ id, at }) => {
    db.update(oauthClients)
      .set({ lastUsedAt: toIso(at) })
      .where(eq(oauthClients.id, id))
      .run()
  },
  createCode: (code) => {
    db.insert(oauthCodes)
      .values({
        ...code,
        expiresAt: toIso(code.expiresAt),
        usedAt: toNullable(code.usedAt === undefined ? undefined : toIso(code.usedAt)),
      })
      .run()
  },
  consumeCode: ({ codeHash, usedAt }) =>
    db.transaction((tx) => {
      const live = and(eq(oauthCodes.codeHash, codeHash), isNull(oauthCodes.usedAt))
      const row = tx.select().from(oauthCodes).where(live).get()
      if (row === undefined) return undefined
      tx.update(oauthCodes)
        .set({ usedAt: toIso(usedAt) })
        .where(live)
        .run()
      return toCode(row)
    }),
  createToken: (token) => {
    db.insert(oauthTokens)
      .values({
        tokenHash: token.tokenHash,
        assistantId: token.assistantId,
        kind: token.kind,
        expiresAt: toIso(token.expiresAt),
        rotatedAt: toNullable(token.rotatedAt === undefined ? undefined : toIso(token.rotatedAt)),
      })
      .run()
  },
  findToken: (tokenHash) => {
    const row = db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, tokenHash)).get()
    return row && toToken(row)
  },
  markRotated: ({ tokenHash, at }) =>
    db.transaction((tx) => {
      const live = and(eq(oauthTokens.tokenHash, tokenHash), isNull(oauthTokens.rotatedAt))
      if (
        tx.select({ hash: oauthTokens.tokenHash }).from(oauthTokens).where(live).get() === undefined
      )
        return false
      tx.update(oauthTokens)
        .set({ rotatedAt: toIso(at) })
        .where(live)
        .run()
      return true
    }),
  purge: ({ now, unusedBefore }) => {
    const nowIso = toIso(now)
    db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, nowIso)).run()
    db.delete(oauthTokens).where(lt(oauthTokens.expiresAt, nowIso)).run()
    db.delete(oauthClients)
      .where(
        and(
          eq(oauthClients.kind, 'dcr'),
          notExists(
            db
              .select({ id: assistantTokens.id })
              .from(assistantTokens)
              .where(
                and(
                  eq(assistantTokens.clientId, oauthClients.id),
                  isNull(assistantTokens.revokedAt),
                ),
              ),
          ),
          or(
            and(
              isNotNull(oauthClients.lastUsedAt),
              lt(oauthClients.lastUsedAt, toIso(unusedBefore)),
            ),
            and(isNull(oauthClients.lastUsedAt), lt(oauthClients.createdAt, toIso(unusedBefore))),
          ),
        ),
      )
      .run()
  },
})
