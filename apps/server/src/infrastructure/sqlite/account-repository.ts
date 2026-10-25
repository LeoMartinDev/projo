import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'

import type { Account, AccountRepository } from '../../core/auth/account.ts'
import type { Db } from './database.ts'
import { insertProfile } from './profile-repository.ts'
import { fromIso, fromIsoNullable, toIso, toNullable } from './rows.ts'
import { accounts } from './schema/accounts.ts'

type AccountRow = typeof accounts.$inferSelect

export const toAccount = (row: AccountRow): Account => {
  const disabledAt = fromIsoNullable(row.disabledAt)
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    role: row.role,
    createdAt: fromIso(row.createdAt),
    ...(disabledAt === undefined ? {} : { disabledAt }),
  }
}

export const toAccountRow = (account: Account): AccountRow => ({
  id: account.id,
  username: account.username,
  passwordHash: account.passwordHash,
  role: account.role,
  createdAt: toIso(account.createdAt),
  disabledAt: toNullable(account.disabledAt && toIso(account.disabledAt)),
})

/** Case-insensitive username lookup, usable inside a transaction. */
export const usernameTaken = (db: Pick<Db, 'select'>, username: string): boolean =>
  db
    .select({ id: accounts.id })
    .from(accounts)
    .where(sql`lower(${accounts.username}) = lower(${username})`)
    .get() !== undefined

export const createSqliteAccountRepository = ({ db }: { db: Db }): AccountRepository => ({
  findById: (id) => {
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get()
    return row && toAccount(row)
  },
  findByUsername: (username) => {
    const row = db
      .select()
      .from(accounts)
      .where(sql`lower(${accounts.username}) = lower(${username})`)
      .get()
    return row && toAccount(row)
  },
  count: () => db.select({ value: count() }).from(accounts).get()?.value ?? 0,
  list: () =>
    db
      .select()
      .from(accounts)
      .orderBy(asc(accounts.createdAt), asc(accounts.id))
      .all()
      .map(toAccount),
  countEnabledAdmins: () =>
    db
      .select({ value: count() })
      .from(accounts)
      .where(and(eq(accounts.role, 'admin'), isNull(accounts.disabledAt)))
      .get()?.value ?? 0,
  create: ({ account, profile }) =>
    db.transaction((tx) => {
      if (usernameTaken(tx, account.username)) return 'username_taken'
      tx.insert(accounts).values(toAccountRow(account)).run()
      insertProfile(tx, profile)
      return 'created'
    }),
  setRole: ({ id, role }) => {
    db.update(accounts).set({ role }).where(eq(accounts.id, id)).run()
  },
  setDisabled: ({ id, disabledAt }) => {
    db.update(accounts)
      .set({ disabledAt: toNullable(disabledAt && toIso(disabledAt)) })
      .where(eq(accounts.id, id))
      .run()
  },
  setPasswordHash: ({ id, passwordHash }) => {
    db.update(accounts).set({ passwordHash }).where(eq(accounts.id, id)).run()
  },
  delete: (id) => {
    db.delete(accounts).where(eq(accounts.id, id)).run()
  },
})
