import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { systemClock } from '../../src/infrastructure/clock/system-clock.ts'
import { silentLogger } from './logger.ts'
import { type Db, openDatabase } from '../../src/infrastructure/sqlite/database.ts'

export const migrationsDir = resolve(import.meta.dir, '../../drizzle')

/** Fresh in-memory SQLite with every migration applied. One per test for isolation. */
export const createTestDatabase = (): Db => {
  const opened = openDatabase({
    file: ':memory:',
    migrationsDir,
    clock: systemClock,
    logger: silentLogger,
  })
  if (!opened.ok) throw new Error(`test database: ${opened.error.message}`, { cause: opened.error })
  return opened.value
}

/** Temporary directory removed by `cleanup()` (use in `afterEach`). */
export const createTempDir = (prefix = 'projo-test-') => {
  const path = mkdtempSync(join(tmpdir(), prefix))
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) }
}
