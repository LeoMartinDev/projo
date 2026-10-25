import { count } from 'drizzle-orm'

import type { SetupRepository } from '../../core/setup/setup.ts'
import { toAccountRow } from './account-repository.ts'
import type { Db } from './database.ts'
import { insertProfile } from './profile-repository.ts'
import { toIso } from './rows.ts'
import { accounts } from './schema/accounts.ts'
import { settings } from './schema/ops.ts'

const accountCount = (db: Pick<Db, 'select'>): number =>
  db.select({ value: count() }).from(accounts).get()?.value ?? 0

/** The check and the writes share one transaction: a concurrent second setup sees the account. */
export const createSqliteSetupRepository = ({ db }: { db: Db }): SetupRepository => ({
  isCompleted: () => accountCount(db) > 0,
  complete: ({ account, profile, settings: values, at }) =>
    db.transaction((tx) => {
      if (accountCount(tx) > 0) return 'already_completed'
      tx.insert(accounts).values(toAccountRow(account)).run()
      insertProfile(tx, profile)
      for (const [key, value] of Object.entries(values)) {
        tx.insert(settings)
          .values({ key, value, updatedAt: toIso(at) })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: toIso(at) } })
          .run()
      }
      return 'completed'
    }),
})
