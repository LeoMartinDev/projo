import { eq } from 'drizzle-orm'

import type { SettingsRepository } from '../../core/settings/settings.ts'
import type { Db } from './database.ts'
import { settings } from './schema/ops.ts'

export const createSqliteSettingsRepository = ({ db }: { db: Db }): SettingsRepository => ({
  get: (key) => db.select().from(settings).where(eq(settings.key, key)).get()?.value,
})
