import { eq } from 'drizzle-orm'

import type { SettingsRepository } from '../../core/settings/settings.ts'
import type { Db } from './database.ts'
import { settings } from './schema/ops.ts'

/** `settings` key/value table (§5.4). Values are JSON: callers validate their own key. */
export const createSqliteSettingsRepository = ({ db }: { db: Db }): SettingsRepository => ({
  get: (key) => db.select().from(settings).where(eq(settings.key, key)).get()?.value,
})
