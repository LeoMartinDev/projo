import { Database as SqliteClient } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import * as schema from './schema/index.ts'

export type Db = BunSQLiteDatabase<typeof schema> & { $client: SqliteClient }

export type OpenDatabaseError = AppError<
  'db/open_failed' | 'db/migration_failed' | 'db/backup_failed'
>

type OpenDatabaseInput = {
  /** Path of the database file, or `:memory:`. */
  file: string
  migrationsDir: string
  /** When set, an existing database is copied here before pending migrations run. */
  backupsDir?: string
  clock: Clock
  logger: Logger
}

const configure = (client: SqliteClient): void => {
  client.run('PRAGMA journal_mode = WAL')
  client.run('PRAGMA synchronous = NORMAL')
  client.run('PRAGMA foreign_keys = ON')
  client.run('PRAGMA busy_timeout = 5000')
}

/**
 * Finalizes every statement still alive (Drizzle prepares one per query) before closing. A plain
 * `close()` is `sqlite3_close_v2`: with live statements the connection, and its handles on the
 * database, `-wal` and `-shm` files, stays open until they are garbage collected, which on Windows
 * keeps those files locked (they cannot be moved or deleted).
 */
const release = (client: SqliteClient): void => {
  client.close(true)
}

const pendingMigrations = (client: SqliteClient, migrations: MigrationMeta[]): number => {
  const table = client
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get()
  if (table === null) return migrations.length
  const last = client
    .query<{ last: number | null }, []>('SELECT MAX(created_at) AS last FROM __drizzle_migrations')
    .get()
  const lastApplied = last?.last ?? 0
  return migrations.filter((migration) => migration.folderMillis > lastApplied).length
}

const backupFileName = (now: Date): string =>
  `projo-${now.toISOString().replaceAll(':', '-').replace('.', '-')}-pre-migration.db`

/**
 * Opens SQLite (WAL, foreign keys), backs the file up into `backupsDir` when migrations are
 * pending on an existing database, then applies the Drizzle migrations.
 */
export const openDatabase = ({
  file,
  migrationsDir,
  backupsDir,
  clock,
  logger,
}: OpenDatabaseInput): Result<Db, OpenDatabaseError> => {
  const existed = file !== ':memory:' && existsSync(file)

  let client: SqliteClient
  try {
    client = new SqliteClient(file, { create: true, strict: true })
    configure(client)
  } catch (cause) {
    return err(appError('db/open_failed', 'cannot open database', { context: { file }, cause }))
  }

  let migrations: MigrationMeta[]
  try {
    migrations = readMigrationFiles({ migrationsFolder: migrationsDir })
  } catch (cause) {
    release(client)
    return err(
      appError('db/migration_failed', 'cannot read migrations', {
        context: { migrationsDir },
        cause,
      }),
    )
  }

  const pending = pendingMigrations(client, migrations)

  if (existed && pending > 0 && backupsDir !== undefined) {
    const backupFile = join(backupsDir, backupFileName(clock.now()))
    try {
      client.run('VACUUM INTO ?', [backupFile])
      logger.info('database backed up before migration', { backupFile, pending })
    } catch (cause) {
      release(client)
      return err(
        appError('db/backup_failed', 'cannot back up database before migration', {
          context: { backupFile },
          cause,
        }),
      )
    }
  }

  const db = drizzle({ client, schema, casing: 'snake_case' })

  if (pending > 0) {
    try {
      migrate(db, { migrationsFolder: migrationsDir })
    } catch (cause) {
      release(client)
      return err(appError('db/migration_failed', 'database migration failed', { cause }))
    }
    logger.info('database migrated', { applied: pending })
  }

  return ok(db)
}

export const closeDatabase = (db: Db): void => {
  release(db.$client)
}
