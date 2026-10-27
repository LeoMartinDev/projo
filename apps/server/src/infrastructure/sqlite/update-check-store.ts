import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { settingKeys } from '../../core/settings/settings.ts'
import type { UpdateCheckRecord, UpdateCheckStore } from '../../core/updates/update.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { settings } from './schema/ops.ts'

const assetSchema = z.object({ name: z.string(), url: z.string(), sizeBytes: z.number() })

const recordSchema = z.object({
  checkedAt: z.iso.datetime({ offset: true }),
  latest: z
    .object({
      version: z.string(),
      tag: z.string(),
      publishedAt: z.iso.datetime({ offset: true }),
      notes: z.string(),
      url: z.string(),
      archive: assetSchema,
      checksums: assetSchema,
      runtimeMin: z.string(),
    })
    .optional(),
  // any string: a newer version may have written a code this one does not declare
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})

/**
 * `settings.updates.last_check`: what the last `check_updates` found, kept across restarts. A
 * value that no longer parses (older format) reads as "never checked".
 */
export const createSqliteUpdateCheckStore = ({ db }: { db: Db }): UpdateCheckStore => ({
  read: (): UpdateCheckRecord | undefined => {
    const value = db
      .select()
      .from(settings)
      .where(eq(settings.key, settingKeys.updateLastCheck))
      .get()?.value
    const parsed = recordSchema.safeParse(value)
    if (!parsed.success) return undefined
    const { checkedAt, latest, error } = parsed.data
    return {
      checkedAt: new Date(checkedAt),
      ...(latest === undefined
        ? {}
        : { latest: { ...latest, publishedAt: new Date(latest.publishedAt) } }),
      ...(error === undefined ? {} : { error: error as NonNullable<UpdateCheckRecord['error']> }),
    }
  },
  write: (record) => {
    const value = {
      checkedAt: toIso(record.checkedAt),
      ...(record.latest === undefined
        ? {}
        : { latest: { ...record.latest, publishedAt: toIso(record.latest.publishedAt) } }),
      ...(record.error === undefined
        ? {}
        : { error: { code: record.error.code, message: record.error.message } }),
    }
    const updatedAt = toIso(record.checkedAt)
    db.insert(settings)
      .values({ key: settingKeys.updateLastCheck, value, updatedAt })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
      .run()
  },
})
