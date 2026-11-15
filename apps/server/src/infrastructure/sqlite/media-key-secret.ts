import { eq } from 'drizzle-orm'
import { z } from 'zod'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { settingKeys } from '../../core/settings/settings.ts'
import type { Db } from './database.ts'
import { parseJsonColumn, toIso } from './rows.ts'
import { settings } from './schema/ops.ts'

const secretBytes = 32
const secretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const column = `settings.value (${settingKeys.mediaKeySecret})`

const newSecret = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(secretBytes))).toString('base64url')

const storedValue = (db: Db): { value: unknown } | undefined =>
  db.select().from(settings).where(eq(settings.key, settingKeys.mediaKeySecret)).get()

/**
 * The server's media key secret (§20): 256 random bits generated once and kept in `settings`.
 * Created with insert-or-ignore then read back, so concurrent first uses agree on one secret. A
 * stored value that does not parse is a violated invariant: logged, then replaced (every media key
 * issued so far stops working; clients get a new one from `GET /auth/me`).
 */
export const loadOrCreateMediaKeySecret = ({
  db,
  clock,
  logger,
}: {
  db: Db
  clock: Clock
  logger: Logger
}): Uint8Array => {
  if (storedValue(db) === undefined) {
    db.insert(settings)
      .values({
        key: settingKeys.mediaKeySecret,
        value: newSecret(),
        updatedAt: toIso(clock.now()),
      })
      .onConflictDoNothing({ target: settings.key })
      .run()
  }
  const stored = storedValue(db)?.value
  try {
    return Buffer.from(parseJsonColumn(secretSchema, stored, column), 'base64url')
  } catch (error) {
    logger.error(
      'invalid media key secret in settings, replacing it: media keys issued so far are void',
      {
        code: 'auth/media_key_secret_invalid',
        error,
      },
    )
    const value = newSecret()
    db.update(settings)
      .set({ value, updatedAt: toIso(clock.now()) })
      .where(eq(settings.key, settingKeys.mediaKeySecret))
      .run()
    return Buffer.from(value, 'base64url')
  }
}
