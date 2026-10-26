import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { NeedsReviewReminderStore } from '../../core/notifications/notification.ts'
import type { NamingRulesVersionStore } from '../../core/scanner/ports.ts'
import {
  defaultServerName,
  type ServerNameStore,
  type SettingKey,
  settingKeys,
} from '../../core/settings/settings.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { settings } from './schema/ops.ts'

const read = (db: Db, key: SettingKey): unknown =>
  db.select().from(settings).where(eq(settings.key, key)).get()?.value

const write = (db: Db, key: SettingKey, value: unknown, at: Date): void => {
  db.insert(settings)
    .values({ key, value, updatedAt: toIso(at) })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: toIso(at) } })
    .run()
}

const nameSchema = z.string().trim().min(1)

/** `server.name` (§15 "Server"); unset or invalid reads as `projo`. */
export const createSqliteServerNameStore = ({ db }: { db: Db }): ServerNameStore => ({
  read: () => {
    const parsed = nameSchema.safeParse(read(db, settingKeys.serverName))
    return parsed.success ? parsed.data : defaultServerName
  },
  write: ({ name, at }) => write(db, settingKeys.serverName, name, at),
})

const versionSchema = z.number().int().positive()

/** `scanner.naming_rules_version` (§7.4 "Startup"); unset or invalid reads as never read. */
export const createSqliteNamingRulesVersionStore = ({
  db,
}: {
  db: Db
}): NamingRulesVersionStore => ({
  read: () => {
    const parsed = versionSchema.safeParse(read(db, settingKeys.namingRulesVersion))
    return parsed.success ? parsed.data : undefined
  },
  write: ({ version, at }) => write(db, settingKeys.namingRulesVersion, version, at),
})

const instantSchema = z.iso.datetime({ offset: true })

/** `notifications.needs_review_notified_at` (§15 `scan/needs_review_count`, daily). */
export const createSqliteNeedsReviewReminderStore = ({
  db,
}: {
  db: Db
}): NeedsReviewReminderStore => ({
  read: () => {
    const parsed = instantSchema.safeParse(read(db, settingKeys.needsReviewNotifiedAt))
    return parsed.success ? new Date(parsed.data) : undefined
  },
  write: (at) => write(db, settingKeys.needsReviewNotifiedAt, toIso(at), at),
})
