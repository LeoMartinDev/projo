import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { settingKeys } from '../../core/settings/settings.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { createCapturingLogger, silentLogger } from '../../../test/support/logger.ts'
import { loadOrCreateMediaKeySecret } from './media-key-secret.ts'
import { settings } from './schema/ops.ts'

const stored = (db: ReturnType<typeof createTestDatabase>) =>
  db.select().from(settings).where(eq(settings.key, settingKeys.mediaKeySecret)).get()?.value

test('generated once (256 bits), then read back unchanged', () => {
  const db = createTestDatabase()
  const clock = createManualClock()
  expect(stored(db)).toBeUndefined()
  const first = loadOrCreateMediaKeySecret({ db, clock, logger: silentLogger })
  expect(first.length).toBe(32)
  expect(stored(db)).toEqual(Buffer.from(first).toString('base64url'))
  expect(loadOrCreateMediaKeySecret({ db, clock, logger: silentLogger })).toEqual(first)
  expect(
    loadOrCreateMediaKeySecret({ db: createTestDatabase(), clock, logger: silentLogger }),
  ).not.toEqual(first)
})

test('a secret another first use stored wins: insert or ignore, then read back', () => {
  const db = createTestDatabase()
  const clock = createManualClock()
  const theirs = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url')
  db.insert(settings)
    .values({
      key: settingKeys.mediaKeySecret,
      value: theirs,
      updatedAt: clock.now().toISOString(),
    })
    .run()
  expect(Buffer.from(loadOrCreateMediaKeySecret({ db, clock, logger: silentLogger }))).toEqual(
    Buffer.from(theirs, 'base64url'),
  )
})

test('a stored value that does not parse is logged as an error and replaced', () => {
  const db = createTestDatabase()
  const clock = createManualClock()
  const { logger, lines } = createCapturingLogger()
  db.insert(settings)
    .values({
      key: settingKeys.mediaKeySecret,
      value: 'short',
      updatedAt: clock.now().toISOString(),
    })
    .run()
  const secret = loadOrCreateMediaKeySecret({ db, clock, logger })
  expect(secret.length).toBe(32)
  expect(stored(db)).toEqual(Buffer.from(secret).toString('base64url'))
  expect(lines).toEqual([
    expect.objectContaining({
      level: 'error',
      message: expect.stringContaining('media key secret'),
      fields: expect.objectContaining({ code: 'auth/media_key_secret_invalid' }),
    }),
  ])
  expect(loadOrCreateMediaKeySecret({ db, clock, logger })).toEqual(secret)
  expect(lines).toHaveLength(1)
})
