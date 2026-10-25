import { eq } from 'drizzle-orm'

import type { MetadataSettings } from '../../core/metadata/ports.ts'
import { type SettingKey, settingKeys } from '../../core/settings/settings.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { settings } from './schema/ops.ts'

/** §9.1 default metadata language. */
export const DEFAULT_METADATA_LANGUAGE = 'fr-FR'

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/** Metadata keys of the `settings` table (§5.4). */
export const createSqliteMetadataSettings = ({ db }: { db: Db }): MetadataSettings => {
  const read = (key: SettingKey): unknown =>
    db.select().from(settings).where(eq(settings.key, key)).get()?.value
  const write = (key: SettingKey, value: string | undefined, at: Date): void => {
    if (value === undefined) {
      db.delete(settings).where(eq(settings.key, key)).run()
      return
    }
    db.insert(settings)
      .values({ key, value, updatedAt: toIso(at) })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: toIso(at) } })
      .run()
  }
  return {
    tmdbApiKey: () => asString(read(settingKeys.tmdbApiKey)),
    language: () => asString(read(settingKeys.metadataLanguage)) ?? DEFAULT_METADATA_LANGUAGE,
    setTmdbApiKey: ({ key, at }) => {
      write(settingKeys.tmdbApiKey, key, at)
      write(settingKeys.tmdbApiKeyRejectedAt, undefined, at)
    },
    tmdbApiKeyRejectedAt: () => {
      const value = asString(read(settingKeys.tmdbApiKeyRejectedAt))
      return value === undefined ? undefined : new Date(value)
    },
    markTmdbApiKeyRejected: (at) => write(settingKeys.tmdbApiKeyRejectedAt, toIso(at), at),
    setLanguage: ({ language, at }) => write(settingKeys.metadataLanguage, language, at),
  }
}
